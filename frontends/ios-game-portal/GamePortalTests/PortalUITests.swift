import XCTest

final class PortalUITests: XCTestCase {
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
        app.buttons["Choose mode"].tap()
        app.buttons["Start match  →"].tap()
        let firstCell = app.webViews.buttons["Row 1, column 1, empty"]
        XCTAssertTrue(firstCell.waitForExistence(timeout: 15))
        firstCell.tap()
        let handoff = app.buttons["I’m Player 2 · Continue"]
        XCTAssertTrue(handoff.waitForExistence(timeout: 5))

        // A new process must restore the match, including its pending handoff.
        app.terminate()
        app.launch()
        app.tabBars.buttons["My Matches"].tap()
        let match = app.buttons.containing(.staticText, identifier: "Tic-Tac-Toe").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 5))
        match.tap()
        XCTAssertTrue(handoff.waitForExistence(timeout: 5))
        handoff.tap()
        XCTAssertTrue(app.webViews.buttons["Row 1, column 1, X"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.webViews.buttons["Row 1, column 1, X"].isEnabled)

        for (row, col, next) in [(2, 1, "Juan"), (1, 2, "Player 2"), (2, 2, "Juan")] {
            app.webViews.buttons["Row \(row), column \(col), empty"].tap()
            let button = app.buttons["I’m \(next) · Continue"]
            XCTAssertTrue(button.waitForExistence(timeout: 5))
            button.tap()
            XCTAssertTrue(app.webViews.buttons.firstMatch.waitForExistence(timeout: 10))
        }
        app.webViews.buttons["Row 1, column 3, empty"].tap()
        XCTAssertTrue(app.staticTexts["Juan won"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Finished local match"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Finished"].tap()
        XCTAssertTrue(app.staticTexts["Juan won"].waitForExistence(timeout: 5))
    }
}
