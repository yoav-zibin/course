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
        // Leave the verified content on screen while the host saves its image.
        Thread.sleep(forTimeInterval: 5)
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
            var matching = 0
            for i in stride(from: 0, to: rgb.count, by: 4) {
                let r = Int(rgb[i]), g = Int(rgb[i+1]), b = Int(rgb[i+2])
                switch screen {
                case .opening:
                    if r>95 && r>g+34 && g>b+18 { matching += 1 }
                case .setup:
                    if r<42 && g<65 && g>r+8 && g>b+7 { matching += 1 }
                }
            }
            return matching>width*height/10
        }
    }
}
