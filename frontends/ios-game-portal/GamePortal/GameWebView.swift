import SwiftUI
import WebKit

struct GameWebView: UIViewRepresentable {
    let match: Match
    let onMove: (Int, Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "portal")
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Game") {
            context.coordinator.gameURL = url
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            #if DEBUG
            print("LocalGame: bundled document is missing")
            #endif
        }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.sendState(view)
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "portal")
        view.navigationDelegate = nil
    }
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: GameWebView
        var gameURL: URL?
        var ready = false
        init(_ parent: GameWebView) { self.parent = parent }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            #if DEBUG
            print("LocalGame: document finished loading")
            #endif
            ready = true
            sendState(webView)
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let allowed = navigationAction.request.url == gameURL && navigationAction.targetFrame?.isMainFrame == true
            #if DEBUG
            let mainFrame = navigationAction.targetFrame.map { String($0.isMainFrame) } ?? "none"
            print("LocalGame: navigation mainFrame=\(mainFrame), allowed=\(allowed)")
            #endif
            decisionHandler(allowed ? .allow : .cancel)
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            logFailure(error, event: "navigation failed")
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            logFailure(error, event: "provisional navigation failed")
        }
        private func logFailure(_ error: Error, event: String) {
            #if DEBUG
            let failure = error as NSError
            print("LocalGame: \(event) (\(failure.domain), \(failure.code))")
            #endif
        }
        func sendState(_ view: WKWebView) {
            guard ready else { return }
            let match = parent.match
            let players: [[String: Any]] = [0, 1].map { ["player_index": $0, "kind": "human"] }
            let payload: [String: Any] = [
                "message_kind": "state_change",
                "state": ["board": match.board.map { $0 as Any? ?? NSNull() }],
                "turn_of_user": match.isOver ? NSNull() : players[match.turn] as Any,
                "my_user": players[match.turn],
                "players": players
            ]
            view.callAsyncJavaScript("window.receiveState(payload)", arguments: ["payload": payload], in: nil, in: .page) { result in
                if case .failure(let error) = result {
                    self.logFailure(error, event: "state delivery failed")
                }
            }
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, message.frameInfo.request.url == gameURL,
                  let body = message.body as? [String: Any], body["message_kind"] as? String == "make_move",
                  let next = body["next_state"] as? [String: Any], let board = next["board"] as? [Any], board.count == 9,
                  let player = body["turn_of_player_index"] as? Int else { return }
            let proposed: [String?] = board.map { $0 as? String }
            let changed = (0..<9).filter { proposed[$0] != parent.match.board[$0] }
            guard changed.count == 1, let cell = changed.first,
                  proposed[cell] == (player == 0 ? "X" : "O") else { return }
            parent.onMove(cell, player)
        }
    }
}
