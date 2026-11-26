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

    private var scale: CGFloat {
        min(board.frame.width / pose.bounds.width, board.frame.height / pose.bounds.height)
    }

    private func coordinate(_ point: Pose.Point, lift: Bool = false) -> XCUICoordinate {
        let frame = board.frame, b = pose.bounds, s = scale
        let dx = (frame.width - b.width * s) / 2 + (point.x - b.x) * s
        var dy = (frame.height - b.height * s) / 2 + (point.y - b.y) * s
        if lift { dy += min(54, pose.height * s * 0.6 + 22, frame.height / 3) }
        return board.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: dx, dy: dy))
    }

    private func sample(_ body: () -> Void) {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        options.invocationOptions = [.manuallyStart, .manuallyStop]
        measure(metrics: [XCTClockMetric(), XCTHitchMetric(application: app)], options: options, block: body)
    }

    func testSelectChecker() {
        let cancel = element("Cancel selection")
        sample {
            let source = coordinate(pose.source)
            startMeasuring()
            source.tap()
            XCTAssertTrue(cancel.waitForExistence(timeout: 5))
            stopMeasuring()
            cancel.tap()
            XCTAssertTrue(cancel.waitForNonExistence(timeout: 5))
        }
    }

    func testDragChecker() {
        let source = coordinate(pose.source)
        let end = Pose.Point(x: pose.source.x, y: pose.bounds.y + pose.bounds.height * 0.92)
        let destination = coordinate(end)
        let frame = board.frame, b = pose.bounds, s = scale
        let x = frame.midX + (pose.source.x - b.x - b.width/2)*s
        let y = frame.midY + (pose.source.y - b.y - b.height/2)*s
        let endY = frame.midY + (end.y - b.y - b.height/2)*s
        print("TRACK_GEOMETRY \(app.frame.width) \(app.frame.height) \(x) \(y) \(endY) \(s*pose.height)")
        sample {
            startMeasuring()
            source.press(forDuration: 0.05, thenDragTo: destination, withVelocity: 180, thenHoldForDuration: 0)
            stopMeasuring()
            let cancel = element("Cancel selection")
            if cancel.exists { cancel.tap() }
        }
    }

    func testCommitChecker() {
        let source = coordinate(pose.source), destination = coordinate(pose.destination, lift: true)
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
