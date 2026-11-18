import XCTest

final class PortalUITests: XCTestCase {
    // Cold WebKit processes on hosted Intel Macs can take longer than local runs.
    private let boardLoadTimeout: TimeInterval = 60
    private let transitionTimeout: TimeInterval = 15

    private func tapEmptyCell(row: Int, column: Int, in app: XCUIApplication) {
        let cell = app.webViews.buttons["Row \(row), column \(column), empty"]
        // Each handoff creates a new WKWebView. An accessibility element can
        // exist before its layout and playable state are ready for a tap.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            cell.exists && cell.isEnabled && cell.isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: boardLoadTimeout), .completed,
                       "Expected an enabled, hittable empty cell at row \(row), column \(column)")
        cell.tap()
    }

    override func tearDownWithError() throws {
        if let testRun, testRun.failureCount > 0 {
            // Capture the whole device even if the app crashed or failed to launch.
            attachScreenshot(XCUIScreen.main.screenshot(), named: "Failure - \(name)")
        }
        try super.tearDownWithError()
    }

    private func attachScreenshot(_ screenshot: XCUIScreenshot, named name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testLocalMatchFlow() {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        if app.buttons["Play as guest  →"].waitForExistence(timeout: 5) {
            app.textFields["guestName"].tap()
            app.textFields["guestName"].typeText("Juan")
            app.buttons["Play as guest  →"].tap()
        }
        app.tabBars.buttons["Discover"].tap()
        attachScreenshot(app.screenshot(), named: "Discover carousel")
        app.tabBars.buttons["Local Matches"].tap()
        XCTAssertTrue(app.staticTexts["Your games on this phone."].waitForExistence(timeout: 5))
        app.tabBars.buttons["Discover"].tap()
        app.buttons["Pass and play"].tap()
        let firstPlayer = app.textFields["firstPlayer"].value as? String ?? "Juan"
        app.buttons["Start match  →"].tap()
        tapEmptyCell(row: 1, column: 1, in: app)
        let handoff = app.buttons["I’m Player 2 · Continue"]
        XCTAssertTrue(handoff.waitForExistence(timeout: transitionTimeout))

        // A new process must restore the match, including its pending handoff.
        app.terminate()
        app.launch()
        app.tabBars.buttons["Local Matches"].tap()
        let match = app.buttons.containing(.staticText, identifier: "Tic-Tac-Toe").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: transitionTimeout))
        match.tap()
        XCTAssertTrue(handoff.waitForExistence(timeout: transitionTimeout))
        handoff.tap()
        XCTAssertTrue(app.webViews.buttons["Row 1, column 1, X"].waitForExistence(timeout: boardLoadTimeout))
        XCTAssertFalse(app.webViews.buttons["Row 1, column 1, X"].isEnabled)
        attachScreenshot(app.screenshot(), named: "Restored local match")

        for (row, col, next) in [(2, 1, firstPlayer), (1, 2, "Player 2"), (2, 2, firstPlayer)] {
            tapEmptyCell(row: row, column: col, in: app)
            let button = app.buttons["I’m \(next) · Continue"]
            XCTAssertTrue(button.waitForExistence(timeout: transitionTimeout))
            button.tap()
        }
        tapEmptyCell(row: 1, column: 3, in: app)
        XCTAssertTrue(app.staticTexts["\(firstPlayer) won"].waitForExistence(timeout: transitionTimeout))
        attachScreenshot(app.screenshot(), named: "Finished local match")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Finished"].tap()
        XCTAssertTrue(app.staticTexts["\(firstPlayer) won"].waitForExistence(timeout: 5))
    }
}
