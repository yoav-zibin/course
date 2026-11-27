import XCTest

final class ResponseTests: XCTestCase {
    private struct Point: Decodable { let x, y: CGFloat }
    private struct Bounds: Decodable { let x, y, width, height: CGFloat }
    private struct Action: Decodable { let id: String; let label, until, absent: String?; let at, to, spentDie: Point?; let lift: CGFloat? }
    private struct Scenario: Decodable { let id, match: String; let bounds: Bounds; let actions: [Action] }
    private struct Cases: Decodable { let library: String; let profile: Bool; let rapid, instruments: Bool?; let scenarios: [Scenario] }
    private let app = XCUIApplication(bundleIdentifier: "edu.columbia.gameportal.starter")

    private func element(_ name: String) -> XCUIElement {
        let exact = NSPredicate(format: "identifier == %@ OR label == %@", name, name)
        return app.descendants(matching: .any).matching(exact).firstMatch
    }
    private func runCase(_ name: String) throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let resource = try XCTUnwrap(Bundle(for: Self.self).url(forResource:"response-cases",withExtension:"json"))
        let data = try JSONDecoder().decode(Cases.self,from:Data(contentsOf:resource))
        let scenario = try XCTUnwrap(data.scenarios.first { $0.id == name })
        if data.instruments==true {app.launchEnvironment["BUILDPLAY_CHECKER_SIGNPOSTS"]="1"}
        else {app.launchEnvironment["BUILDPLAY_LOCAL_UI_TEST"] = "1"}
        app.launchEnvironment["DYLD_INSERT_LIBRARIES"] = data.library
        if data.profile {app.launchEnvironment["BUILDPLAY_RESPONSE_STACKS"]="1"}
        app.launch()
        let canvas = element("Game board. Use pieces and highlighted destinations.")
        // The restored game installs its URL listener as part of startup.
        // Wait for the warm board before asking UIKit to open the test match.
        if data.instruments==true {
            let login=app.buttons["Log in / continue as guest"]
            if login.waitForExistence(timeout:10) {
                for _ in 0..<7 {if login.isHittable {break};app.swipeUp()}
                login.tap()
                let guest=app.buttons.matching(NSPredicate(format:"label == %@ OR label ENDSWITH %@","Guest",": Guest")).firstMatch
                XCTAssertTrue(guest.waitForExistence(timeout:15));guest.tap()
                let field=app.textFields.firstMatch
                field.tap();field.typeText("Benchmark\n")
                let submit=app.buttons["Continue as guest"];submit.tap()
                XCTAssertTrue(submit.waitForNonExistence(timeout:20))
            }
        } else {XCTAssertTrue(canvas.waitForExistence(timeout:30),app.debugDescription)}
        app.open(try XCTUnwrap(URL(string:"buildplay:///#match="+scenario.match)))
        let board = canvas.waitForExistence(timeout:10) ? canvas : element("game-stage")
        XCTAssertTrue(board.waitForExistence(timeout:25),app.debugDescription)
        Thread.sleep(forTimeInterval:1.4)
        func coordinate(_ point:Point, lift:CGFloat = 0) -> XCUICoordinate {
            let f=board.frame, b=scenario.bounds, s=min(f.width/b.width,f.height/b.height)
            let x=f.midX+(point.x-b.x-b.width/2)*s, y=f.midY+(point.y-b.y-b.height/2)*s
            return app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:x-app.frame.minX,dy:y-app.frame.minY+(lift>0 ? min(54,lift*s*0.6+22,f.height/3):0)))
        }
        if data.rapid==true || data.instruments==true {
            let paths=try scenario.actions.map { action in
                (action.id,coordinate(try XCTUnwrap(action.at)).screenPoint,coordinate(try XCTUnwrap(action.to),lift:action.lift ?? 0).screenPoint)
            }
            XCTAssertEqual(paths.count,2)
            if data.instruments==true {
                // Resolve the accessibility tree before profiling. Public drag
                // calls can request a new snapshot while the board is updating.
                for action in scenario.actions {
                    if let die=action.spentDie {
                        let p=coordinate(die).screenPoint
                        print("RESPONSE_DIE \(name) \(action.id) \(p.x) \(p.y)")
                    }
                }
                var request=URLRequest(url:try XCTUnwrap(URL(string:"http://127.0.0.1:18766/ready")))
                request.httpMethod="POST";request.timeoutInterval=140
                let ready=expectation(description:"Profiler ready for checker input")
                URLSession.shared.dataTask(with:request){_,response,error in
                    XCTAssertNil(error);XCTAssertEqual((response as? HTTPURLResponse)?.statusCode,200);ready.fulfill()
                }.resume()
                wait(for:[ready],timeout:145)
            }
            let end=expectation(description:"UIKit delivered both drags")
            let pair="RESPONSE_PAIR \(name) \(paths[0].0) \(paths[1].0)"
            print("\(pair) begin \(Date().timeIntervalSince1970*1000)")
            BPPerformCheckerDrags(paths[0].1,paths[0].2,paths[1].1,paths[1].2,data.rapid==true ? 0.06 : 2.5) { ok,error in
                XCTAssertTrue(ok,error?.localizedDescription ?? "XCTest could not inject the two drags")
                end.fulfill()
            }
            wait(for:[end],timeout:30)
            print("\(pair) end \(Date().timeIntervalSince1970*1000)")
            Thread.sleep(forTimeInterval:1.3)
            return
        }
        for action in scenario.actions {
            let target: XCUICoordinate
            if let at=action.at { target=coordinate(at) }
            else {
                let control=element(try XCTUnwrap(action.label))
                XCTAssertTrue(control.waitForExistence(timeout:12), "Missing "+(action.label ?? "control")+" in "+name+" "+app.debugDescription)
                target=control.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.5))
            }
            let end=action.to.map{coordinate($0,lift:action.lift ?? 0)}
            if let die=action.spentDie {
                let p=coordinate(die).screenPoint
                print("RESPONSE_DIE \(name) \(action.id) \(p.x) \(p.y)")
            }
            Thread.sleep(forTimeInterval:0.45)
            print("RESPONSE_ACTION \(name) \(action.id) begin \(Date().timeIntervalSince1970*1000)")
            if let end=end { target.press(forDuration:0.035,thenDragTo:end,withVelocity:230,thenHoldForDuration:0) } else { target.tap() }
            if let until=action.until { XCTAssertTrue(element(until).waitForExistence(timeout:12),until) }
            if action.id=="open-report" {XCTAssertTrue(element("Screenshot captured before opening this report").waitForExistence(timeout:10))}
            if let absent=action.absent { XCTAssertTrue(element(absent).waitForNonExistence(timeout:12),absent) }
            if action.spentDie != nil {Thread.sleep(forTimeInterval:1.0)}
            print("RESPONSE_ACTION \(name) \(action.id) end \(Date().timeIntervalSince1970*1000)")
        }
        Thread.sleep(forTimeInterval:1.3)
    }
    func testConnectPass() throws { try runCase("connect4-pass") }
    func testConnectComputer() throws { try runCase("connect4-computer") }
    func testBackgammonPass() throws { try runCase("backgammon-pass") }
    func testEasy() throws { try runCase("backgammon-computer-easy") }
    func testMedium() throws { try runCase("backgammon-computer-medium") }
    func testHard() throws { try runCase("backgammon-computer-hard") }
    func testExpert() throws { try runCase("backgammon-computer-expert") }
    func testOptions() throws { try runCase("backgammon-computer-medium-setup") }
    func testMidgamePair() throws { try runCase("backgammon-pass-midgame") }
}
