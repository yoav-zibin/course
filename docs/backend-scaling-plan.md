# Backend scaling plan

## Target and current gap

The assignment's stated targets are 10,000,000 users, 1,000,000,000 matches, and
100,000 games in the dataset, plus peak traffic at that scale. The record counts define
data volume, but the peak-traffic objective still needs measurable concurrency or
requests-per-second and latency targets before VM sizes or a capacity claim can be
justified.

The current server is not safe to scale by adding a second VM. `FirestoreStore` loads
every record into each process at startup, serves reads from its private in-memory
copy, and periodically writes changed records. Two processes would have divergent
copies and can overwrite one another. Several lookups also scan all records, including
finding matches involving a user, open matches, quick-match candidates, and users linked
to a login credential. `GamePlatform` serializes operations behind one process-wide
lock; that limits parallelism within a VM and does not coordinate requests handled by
another VM.

## Recommended direction

1. Keep the API tier stateless and run two or more identical instances behind a
   Google Cloud load balancer. Use a managed instance group if the demonstration should
   also show instance replacement or autoscaling.
2. Create a separate Firestore database for the scale demonstration. Give both VMs a
   dedicated service account with only the database access the server needs. Keep
   production data and demo/load-test data separate.
3. Replace the snapshot-oriented Firestore adapter with request-time document access.
   A normal request should read only the user, game, match, and other records it needs;
   it should never load the whole database or write a process-wide snapshot.
4. Make state-changing match operations atomic across VM instances. Read the current
   match, validate the turn/version, and commit the new state and move history in a
   Firestore transaction or equivalent compare-and-set operation. Replace the one
   process-wide lock with narrower coordination so unrelated requests can proceed
   concurrently.
5. Add queryable fields and indexes for actual access patterns, especially matches by
   player, owner, status and game; user authentication and referral-code lookups;
   published-game browsing; and invitations. Add cursor pagination to unbounded list
   endpoints and make admin/export operations explicit batch jobs. Replace startup
   scans with targeted work queues for tasks such as resuming computer moves.
6. Load-test the database and both API instances with the target-sized dataset and
   representative read/write mixes. Report throughput, p50/p95/p99 latency, error rate,
   instance CPU/memory, and Firestore operations/cost. A record-count target alone
   cannot demonstrate request capacity.

## Demonstration sequence

1. Deploy the request-based store and verify correctness against the Firestore
   emulator.
2. Provision the isolated Firestore database and two matching VM instances; route both
   through the same load balancer and service configuration.
3. Seed generated records up to the target dataset size and confirm a write sent to one
   VM is immediately visible through the other.
4. Run the same workload first on one VM and then on two behind the load balancer.
   Increase concurrent clients in stages, keeping the request mix and dataset fixed.
   Record throughput, p50/p95/p99 latency, and errors at each stage; the highest
   sustained stage that meets the chosen latency and error objectives is the measured
   peak capacity. The two-VM run should show requests being served by both instances.
5. Record the seeded record count and measured peak load. Do not present a smaller
   demonstration dataset as proof that one billion matches were physically loaded.

The HTTP load generator is `course/scale_benchmark.py`; the sample route mix is
`course/benchmark.requests.example.json`. Setup and invocation are documented in the
`Staged HTTP benchmark` section of `course/README.md`. Its current example routes need
pagination before they can safely stand in for a target-sized dataset.

The workload should include the application's common read and write paths, especially
user authentication/profile reads, per-user match lists, quick-match joins, and match
moves. Keep the proportions constant between the one-VM and two-VM runs, and record
them with the results so the measured peak has a clear meaning.

## Decisions needed for capacity sizing

- The peak concurrent-client capacity and request mix will be established by the staged
  load test; the result should be reported as measured capacity for the tested dataset.
- Match retention policy and average match/move payload size.
- Google Cloud project ID, deployment zone/region, machine type, and monthly spend
  limit for the new Compute Engine instance and supporting resources.
- Latency and error-rate objectives to use when selecting the highest sustained test
  stage.

