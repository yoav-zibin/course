import XCTest
import UIKit

final class StartupTests: XCTestCase {
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
        XCTAssertTrue(element("game-stage").waitForExistence(timeout: 25), app.debugDescription)
        // SVG accessibility grouping varies between iOS versions. Verify the
        // wooden board is actually drawn before reporting the load as complete.
        let deadline = Date().addingTimeInterval(10)
        repeat {
            let screenshot = app.screenshot()
            if showsBoard(screenshot) {
                print("STARTUP_MS board \((ProcessInfo.processInfo.systemUptime-start)*1000)")
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

    private func showsBoard(_ screenshot: XCUIScreenshot) -> Bool {
        guard let image = screenshot.image.cgImage else { return false }
        let width = 100, height = 180
        var pixels = [UInt8](repeating: 0, count: width*height*4)
        let info = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.noneSkipLast.rawValue
        return pixels.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width*4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: info) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
            let rgb = bytes.bindMemory(to: UInt8.self)
            var wood = 0
            for i in stride(from: 0, to: rgb.count, by: 4) {
                let r = Int(rgb[i]), g = Int(rgb[i+1]), b = Int(rgb[i+2])
                if r>95 && r>g+34 && g>b+18 { wood += 1 }
            }
            return wood>width*height/10
        }
    }
}
