"""Reserve a worst-case charge before calling the model. Amounts are microdollars."""
import time
from copy import deepcopy
from decimal import Decimal, ROUND_CEILING
from game_platform.model_api import ModelApiError
from game_platform.service import ConflictError, InvalidRequestError

LIMIT = 10_000_000


def validate_tariffs(config):
    rates = (config.builder_input_usd_per_million, config.builder_output_usd_per_million, config.builder_max_input_tokens)
    if None not in rates:
        return rates
    if config.model == 'muse-spark-1.3' and config.base_url.rstrip('/') in (
        'https://api.meta.ai/v1', 'https://api.ai.meta.com/v1',
    ):
        # Standard pricing and context window: dev.meta.ai/docs/pricing-rate-limits and /docs/models.
        defaults = (1.25, 4.25, 1_048_576)
        return tuple(default if rate is None else rate for rate, default in zip(rates, defaults))
    raise InvalidRequestError('Set verified model input/output tariffs and maximum billable input tokens before guided generation')


class BudgetedModel:
    def __init__(self, client, config, platform, owner, draft, job_id=None):
        self.client = client
        self.platform = platform
        self.owner = owner
        self.draft_id = draft.id
        self.revision = draft.revision
        self.charged = (draft.builder_workflow or {}).get("charged_microdollars", 0)
        self.job_id = job_id
        self.input_rate, self.output_rate, self.input_limit = validate_tariffs(config)

    def cost(self, inputs, outputs):
        amount = Decimal(str(self.input_rate)) * inputs + Decimal(str(self.output_rate)) * outputs
        return int(amount.to_integral_value(rounding=ROUND_CEILING))

    def record(self, delta, *, provider_overrun=False):
        revision = self.revision
        if self.job_id:
            revision = self.platform.get_game_draft(caller_id=self.owner, draft_id=self.draft_id).revision
        def change(draft):
            state = draft.builder_workflow
            if state.get('billing_configuration_error') and not provider_overrun:
                raise InvalidRequestError('Provider billing bounds need operator review')
            if self.job_id:
                job = state['job']
                if job['id'] != self.job_id or job['status'] not in ('running','queued') or time.time() >= job['deadline']:
                    raise ConflictError('Build cancelled, expired or replaced')
            total = state.get('charged_microdollars', 0) + delta
            if provider_overrun:
                state['billing_configuration_error'] = True
            elif total > LIMIT:
                raise InvalidRequestError('The next request would exceed the $10 draft budget')
            state['charged_microdollars'] = total
            return draft
        saved = self.platform.change_builder_workflow(caller_id=self.owner, draft_id=self.draft_id, expected_revision=revision, change=change)
        self.revision = saved.revision
        self.charged = saved.builder_workflow['charged_microdollars']

    def checkpoint(self, key, progress):
        """Keep only the latest pending operation, guarded by the draft revision."""
        def change(draft):
            draft.builder_workflow['pending_generation'] = {'key': key, 'progress': deepcopy(progress)}
            return draft
        saved = self.platform.change_builder_workflow(caller_id=self.owner, draft_id=self.draft_id,
                                                      expected_revision=self.revision, change=change)
        self.revision = saved.revision

    def chat(self, messages, *, max_tokens, **options):
        reserve = self.cost(self.input_limit, max_tokens)
        self.record(reserve)
        # An interrupted or unmetered request retains its entire reservation.
        try:
            result = self.client.chat_with_reasoning(messages, max_tokens=max_tokens, **options)
        except ModelApiError as exc:
            self.settle(reserve, exc.usage)
            raise
        self.settle(reserve, result)
        return result.content

    def settle(self, reserve, usage):
        inputs = getattr(usage, 'prompt_tokens', None)
        outputs = getattr(usage, 'completion_tokens', None)
        if inputs is None or outputs is None:
            return
        actual = self.cost(inputs, outputs)
        if actual > reserve:
            self.record(actual-reserve, provider_overrun=True)
            raise InvalidRequestError('Provider usage exceeded configured maximums. Verify billing configuration before retrying')
        self.record(actual - reserve)
