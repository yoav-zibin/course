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
            ready = true
            sendState(webView)
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(navigationAction.request.url == gameURL && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel)
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
            view.callAsyncJavaScript("window.receiveState(payload)", arguments: ["payload": payload], in: nil, in: .page, completionHandler: nil)
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
