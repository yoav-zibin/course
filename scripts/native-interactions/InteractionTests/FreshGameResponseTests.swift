import XCTest

final class FreshGameResponseTests: XCTestCase {
    private let app=XCUIApplication(bundleIdentifier:"edu.columbia.gameportal.starter")
    private struct Config: Decodable { let library: String; let profile: Bool }
    private func element(_ label:String) -> XCUIElement {
        app.descendants(matching:.any).matching(NSPredicate(format:"identifier == %@ OR label == %@",label,label)).firstMatch
    }
    private func tap(_ item:XCUIElement, _ scenario:String, _ action:String) {
        XCTAssertTrue(item.waitForExistence(timeout:20),action)
        for _ in 0..<7 {
            if item.isHittable {break}
            app.swipeUp()
        }
        XCTAssertTrue(item.isHittable,action)
        Thread.sleep(forTimeInterval:0.45)
        print("RESPONSE_ACTION \(scenario) \(action) begin \(Date().timeIntervalSince1970*1000)")
        item.tap()
        print("RESPONSE_ACTION \(scenario) \(action) end \(Date().timeIntervalSince1970*1000)")
    }
    func testCreateFourMatches() throws {
        continueAfterFailure=false
        let url=try XCTUnwrap(Bundle(for:Self.self).url(forResource:"response-cases",withExtension:"json"))
        let config=try JSONDecoder().decode(Config.self,from:Data(contentsOf:url))
        app.launchEnvironment["DYLD_INSERT_LIBRARIES"]=config.library
        if config.profile {app.launchEnvironment["BUILDPLAY_RESPONSE_STACKS"]="1"}
        app.launch()
        tap(app.buttons["Log in / continue as guest"],"guest","open-account")
        let guest=app.buttons.matching(NSPredicate(format:"label == %@ OR label ENDSWITH %@","Guest",": Guest")).firstMatch
        tap(guest,"guest","choose-guest")
        let field=app.textFields.firstMatch
        tap(field,"guest","focus-name")
        field.typeText("Benchmark\n")
        let submit=app.buttons["Continue as guest"]
        tap(submit,"guest","create-guest")
        XCTAssertTrue(submit.waitForNonExistence(timeout:20))
        for (slug,id) in [("connect4","e299b14e-480d-44f3-8132-74282a46cebc"),("backgammon","5f5293c3-2a3a-4eec-b631-9debf59be0ca")] {
            for (mode,label) in [("pass_and_play","Pass and play"),("computer","Play against the computer")] {
                let scenario=slug+"-"+mode
                // Open the real game detail route. The catalog and search are also
                // exercised by the Android and browser launch scenarios.
                app.open(try XCTUnwrap(URL(string:"buildplay:///#game="+id)))
                tap(app.buttons[label].firstMatch,scenario,"start-"+mode)
                XCTAssertTrue(element("Game board. Use pieces and highlighted destinations.").waitForExistence(timeout:25),scenario)
                Thread.sleep(forTimeInterval:1.5)
            }
        }
    }
}
