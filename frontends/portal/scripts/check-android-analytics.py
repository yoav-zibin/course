"""Check Firebase policy in the actual packaged Android manifest emitted by apkanalyzer."""
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.stdin.buffer).getroot()
android = "{http://schemas.android.com/apk/res/android}"
flags = {entry.get(android + "name"): entry.get(android + "value")
         for entry in root.findall("application/meta-data")}
for flag in ("firebase_analytics_collection_enabled", "google_analytics_automatic_screen_reporting_enabled",
             "google_analytics_adid_collection_enabled", "google_analytics_default_allow_ad_personalization_signals"):
    if flags.get(flag) != "false":
        raise SystemExit(f"The release APK must disable {flag} by default.")

service = root.find(f'application/service[@{android}name="com.google.firebase.components.ComponentDiscoveryService"]')
if service is None:
    raise SystemExit("The release APK is missing Firebase component discovery.")
registrar = "com.google.firebase.components:com.google.firebase.analytics.connector.internal.AnalyticsConnectorRegistrar"
if any(entry.get(android + "name") == registrar for entry in service.findall("meta-data")):
    raise SystemExit("The release APK would start Analytics before the Worklet.")
