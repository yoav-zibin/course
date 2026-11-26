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
        let source = coordinate(pose.source), destination = coordinate(pose.destination, lift: true)
        // Release on the opposite row, outside this checker’s legal destinations.
        let middle = coordinate(Pose.Point(x: 680, y: 490), lift: true)
        sample {
            startMeasuring()
            source.press(forDuration: 0.05, thenDragTo: middle, withVelocity: 180, thenHoldForDuration: 0)
            stopMeasuring()
        }
        source.press(forDuration: 0.05, thenDragTo: destination, withVelocity: 180, thenHoldForDuration: 0)
        // The host verifies the exact persisted checker counts and owners after this gesture.
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
