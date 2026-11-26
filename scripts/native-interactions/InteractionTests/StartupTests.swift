import XCTest
import UIKit

final class StartupTests: XCTestCase {
    private enum BoardScreen: String { case opening = "board", setup = "new_board" }
    private let app = XCUIApplication(bundleIdentifier: "edu.columbia.gameportal.starter")
    private func element(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", label, label)).firstMatch
    }

    override func setUp() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    // The host installs a fresh copy for every test. Both timestamps include
    // XCTest event delivery and its accessibility/idle wait.
    func testColdHome() {
        let start = ProcessInfo.processInfo.systemUptime
        app.launch()
        XCTAssertTrue(element("Let’s play.").waitForExistence(timeout: 20))
        print("STARTUP_MS home \((ProcessInfo.processInfo.systemUptime-start)*1000)")
        XCTAssertTrue(element("Play Backgammon").waitForExistence(timeout: 20))
        print("STARTUP_MS catalog \((ProcessInfo.processInfo.systemUptime-start)*1000)")
    }

    func testColdBackgammon() throws {
        let link = try XCTUnwrap(URL(string: "buildplay:///#match=benchmark-opening"))
        let start = ProcessInfo.processInfo.systemUptime
        app.open(link)
        measureBoard(from: start, screen: .opening)
    }

    func testOpenMatchForVideo() throws {
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        try testColdBackgammon()
        // Allow the simulator compositor and its independent encoder to deliver the final frame.
        Thread.sleep(forTimeInterval: 2)
    }

    func testAuthorizeLinkSender() {
        let sender = XCUIApplication(bundleIdentifier: "fun.buildplay.benchmark.linksender")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        sender.launch()
        let start = ProcessInfo.processInfo.systemUptime
        var tappedAt = start
        while ProcessInfo.processInfo.systemUptime - start < 50 {
            if app.state == .runningForeground {
                // Leave the destination foregrounded until the host recorder can
                // capture it. Screen capture here does not attach to BuildPlay.
                let deadline = ProcessInfo.processInfo.systemUptime + 45
                repeat {
                    if showsBoard(XCUIScreen.main.screenshot(), screen: .opening) {
                        Thread.sleep(forTimeInterval: 2)
                        return
                    }
                    Thread.sleep(forTimeInterval: 0.4)
                } while ProcessInfo.processInfo.systemUptime < deadline
                XCTFail("BuildPlay opened without displaying the Backgammon board")
                return
            }
            for owner in [springboard, sender] {
                let button = owner.buttons.matching(NSPredicate(format: "label == %@", "Open")).firstMatch
                if button.exists && button.isHittable {
                    button.tap()
                    tappedAt = ProcessInfo.processInfo.systemUptime
                    break
                }
            }
            // Some iOS versions render the system sheet outside the sender's
            // accessibility hierarchy. Its Open button is at this position in
            // the iPhone 17 portrait recordings.
            if ProcessInfo.processInfo.systemUptime - tappedAt > 7 {
                springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.66, dy: 0.552)).tap()
                tappedAt = ProcessInfo.processInfo.systemUptime
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.lifetime = .keepAlways
        add(image)
        XCTFail("The sender did not hand the match link to BuildPlay")
    }

    private func reveal(_ control: XCUIElement) {
        XCTAssertTrue(control.waitForExistence(timeout: 20), app.debugDescription)
        for _ in 0..<8 {
            if control.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(control.isHittable, control.debugDescription)
    }

    func testNewBackgammon() {
        app.launch()
        let login = app.buttons["Log in / continue as guest"]
        reveal(login)
        login.tap()
        let guest = app.buttons.matching(NSPredicate(format: "label == %@ OR label ENDSWITH %@", "Guest", ": Guest")).firstMatch
        reveal(guest)
        guest.tap()
        let field = app.textFields.firstMatch
        reveal(field)
        field.tap()
        field.typeText("Benchmark\n")
        let signup = app.buttons["Continue as guest"]
        reveal(signup)
        signup.tap()
        XCTAssertTrue(signup.waitForNonExistence(timeout: 20))

        let card = element("Play Backgammon")
        reveal(card)
        let detailsStart = ProcessInfo.processInfo.systemUptime
        card.tap()
        XCTAssertTrue(element("How would you like to play?").waitForExistence(timeout: 20))
        print("STARTUP_MS details \((ProcessInfo.processInfo.systemUptime-detailsStart)*1000)")

        let play = app.buttons["Pass and play"]
        reveal(play)
        let boardStart = ProcessInfo.processInfo.systemUptime
        play.tap()
        measureBoard(from: boardStart, screen: .setup)
    }

    private func measureBoard(from start: TimeInterval, screen: BoardScreen) {
        XCTAssertTrue(element("game-stage").waitForExistence(timeout: 25), app.debugDescription)
        // SVG accessibility grouping varies between iOS versions. Verify the
        // opening board or the new match's options panel has actually drawn.
        let deadline = Date().addingTimeInterval(10)
        repeat {
            let screenshot = app.screenshot()
            if showsBoard(screenshot, screen: screen) {
                print("STARTUP_MS \(screen.rawValue) \((ProcessInfo.processInfo.systemUptime-start)*1000)")
                let evidence = XCTAttachment(screenshot: screenshot)
                evidence.name = "Backgammon opened without cached match data"
                evidence.lifetime = .keepAlways
                add(evidence)
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        } while Date()<deadline
        XCTFail("The Backgammon board never became visible")
    }

    private func showsBoard(_ screenshot: XCUIScreenshot, screen: BoardScreen) -> Bool {
        guard let image = screenshot.image.cgImage else { return false }
        let width = 100, height = 180
        var pixels = [UInt8](repeating: 0, count: width*height*4)
        let info = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.noneSkipLast.rawValue
        return pixels.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width*4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: info) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
            let rgb = bytes.bindMemory(to: UInt8.self)
            var matching = 0, redCheckers = 0, ivoryCheckers = 0
            for i in stride(from: 0, to: rgb.count, by: 4) {
                let r = Int(rgb[i]), g = Int(rgb[i+1]), b = Int(rgb[i+2])
                switch screen {
                case .opening:
                    if r>95 && r>g+34 && g>b+18 { matching += 1 }
                    if r>150 && g<95 && r>g+95 && b<100 { redCheckers += 1 }
                    if r>190 && g>180 && b>160 && abs(r-g)<45 && abs(g-b)<55 { ivoryCheckers += 1 }
                case .setup:
                    if r<42 && g<65 && g>r+8 && g>b+7 { matching += 1 }
                }
            }
            let area=width*height
            return matching>area/10 && (screen == .setup || (redCheckers>area/300 && ivoryCheckers>area/300))
        }
    }
}
