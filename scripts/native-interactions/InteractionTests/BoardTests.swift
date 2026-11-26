import XCTest

final class BoardTests: XCTestCase {
    private struct Pose: Decodable {
        struct Point: Decodable { let x, y: CGFloat }
        struct Bounds: Decodable { let x, y, width, height: CGFloat }
        let source, destination: Point
        let bounds: Bounds
        let checker, target: String
        let height: CGFloat
    }

    private let app = XCUIApplication(bundleIdentifier: "edu.columbia.gameportal.starter")
    private var pose: Pose!
    private var board: XCUIElement!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let url = try XCTUnwrap(Bundle(for: BoardTests.self).url(forResource: "pose", withExtension: "json"))
        pose = try JSONDecoder().decode(Pose.self, from: Data(contentsOf: url))
        XCUIDevice.shared.orientation = .portrait
        app.launchEnvironment["BUILDPLAY_LOCAL_UI_TEST"] = "1"
        app.launch()
        // The game-stage view also exposes geometry on iOS versions that group SVG accessibility children.
        board = element("Game board. Use pieces and highlighted destinations.")
        if !board.waitForExistence(timeout: 12) { board = element("game-stage") }
        XCTAssertTrue(board.waitForExistence(timeout: 45), app.debugDescription)
    }

    private func element(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", label, label)).firstMatch
    }

    private func location(_ point: Pose.Point, in frame: CGRect, lift: Bool = false) -> CGPoint {
        let b = pose.bounds, scale = min(frame.width/b.width, frame.height/b.height)
        let x = frame.midX + (point.x-b.x-b.width/2)*scale
        var y = frame.midY + (point.y-b.y-b.height/2)*scale
        if lift { y += min(54, pose.height*scale*0.6+22, frame.height/3) }
        return CGPoint(x: x, y: y)
    }

    private func coordinate(_ point: CGPoint) -> XCUICoordinate {
        let screen = app.frame
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x-screen.minX, dy: point.y-screen.minY))
    }

    // The canvas can exist before the pieces have rendered and before the
    // launch header has collapsed. Verify a real selection at the projected
    // coordinates, then wait for the unselected canvas to regain its bounds.
    private func readyOpening() -> CGRect {
        let cancel = element("Cancel selection")
        let deadline = Date().addingTimeInterval(35)
        repeat {
            let frame = board.frame
            coordinate(location(pose.source, in: frame)).tap()
            if cancel.waitForExistence(timeout: 2) {
                cancel.tap()
                XCTAssertTrue(cancel.waitForNonExistence(timeout: 5))
                let restored = NSPredicate { _,_ in
                    let current = self.board.frame
                    return abs(current.height-frame.height)<1 && abs(current.minY-frame.minY)<1
                }
                if XCTWaiter.wait(for: [expectation(for: restored, evaluatedWith: board)], timeout: 3) == .completed {
                    return board.frame
                }
            }
        } while Date() < deadline
        XCTFail("Unable to select the opening checker at its projected position")
        return board.frame
    }

    private func sample(_ body: () -> Void) {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        options.invocationOptions = [.manuallyStart, .manuallyStop]
        measure(metrics: [XCTClockMetric(), XCTHitchMetric(application: app)], options: options, block: body)
    }

    func testSelectChecker() {
        let cancel = element("Cancel selection")
        _ = readyOpening()
        sample {
            let source = coordinate(location(pose.source, in: board.frame))
            startMeasuring()
            source.tap()
            XCTAssertTrue(cancel.waitForExistence(timeout: 5))
            stopMeasuring()
            cancel.tap()
            XCTAssertTrue(cancel.waitForNonExistence(timeout: 5))
        }
    }

    func testDragChecker() {
        let frame = readyOpening()
        let end = Pose.Point(x: pose.source.x, y: pose.bounds.y + pose.bounds.height*0.92)
        let source = location(pose.source, in: frame), destination = location(end, in: frame)
        let scale = min(frame.width/pose.bounds.width, frame.height/pose.bounds.height)
        print("TRACK_GEOMETRY \(app.frame.width) \(app.frame.height) \(source.x) \(source.y) \(destination.y) \(scale*pose.height)")
        sample {
            let from = coordinate(source), to = coordinate(destination)
            startMeasuring()
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: 95, thenHoldForDuration: 0)
            stopMeasuring()
            let cancel = element("Cancel selection")
            if cancel.exists { cancel.tap() }
        }
    }

    func testCommitChecker() {
        let frame = readyOpening()
        let source = coordinate(location(pose.source, in: frame))
        let destination = coordinate(location(pose.destination, in: frame, lift: true))
        source.press(forDuration: 0.05, thenDragTo: destination, withVelocity: 180, thenHoldForDuration: 0)
        // Keep the app in the foreground until the accepted move is visible.
        // This particular move makes the previously empty destination a playable point.
        let checker = pose.checker.components(separatedBy: ": ")[0] + ": " + pose.target + ": Move"
        let proof = element(checker)
        if !proof.waitForExistence(timeout: 4) {
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "Board after legal drop"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        // The host checks the persisted counts and owners, including any unintended extra move.
    }

    func testOpenReport() {
        let bug = element("Report a bug or request a feature"), close = element("Close dialog")
        sample {
            startMeasuring()
            bug.tap()
            XCTAssertTrue(close.waitForExistence(timeout: 8))
            stopMeasuring()
            XCTAssertTrue(element("Screenshot captured before opening this report").exists)
            close.tap()
            XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        }
    }
}
