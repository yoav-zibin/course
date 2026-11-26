import Foundation
import Vision

// Get the rectangle of the actual home title in the simulator screenshot.
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(url: url, options: [:]).perform([request])
for observation in request.results ?? [] {
    let text = observation.topCandidates(1).first?.string.lowercased().filter { $0.isLetter }
    if text == "letsplay" {
        let box = observation.boundingBox
        print(box.minX, 1-box.maxY, box.maxX, 1-box.minY)
        exit(0)
    }
}
exit(1)
