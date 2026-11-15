import SwiftUI

struct ContentView: View {
    @State private var status = "Tap the button to check the live server."
    @State private var isChecking = false

    var body: some View {
        VStack(spacing: 20) {
            Text("BuildPlay Sample")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("iOS sample for buildplay.fun\nBuilt in the cloud with GitHub Actions — no Mac on your desk involved.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            Button(isChecking ? "Checking…" : "Check server") {
                checkServer()
            }
            .buttonStyle(.borderedProminent)
            .disabled(isChecking)

            Link("Open buildplay.fun", destination: URL(string: "https://buildplay.fun/portal")!)
                .buttonStyle(.bordered)

            Text(status)
                .font(.callout)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding()
    }

    private func checkServer() {
        isChecking = true
        status = "Contacting https://buildplay.fun/health …"
        Task {
            defer { isChecking = false }
            do {
                let (data, response) = try await URLSession.shared.data(
                    from: URL(string: "https://buildplay.fun/health")!
                )
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                let body = String(decoding: data, as: UTF8.self)
                status = "Server replied (HTTP \(code)):\n\(body)"
            } catch {
                status = "Could not reach the server:\n\(error.localizedDescription)"
            }
        }
    }
}

#Preview {
    ContentView()
}
