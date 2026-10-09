import groovy.json.JsonSlurper
import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// The release configuration and keystore live outside Git, on the class build VM.
val configPath = providers.environmentVariable("PORTAL_BUILD_CONFIG").orNull
val buildConfig = configPath?.let { path ->
    val file = file(path).canonicalFile
    require(!file.toPath().startsWith(rootDir.parentFile.canonicalFile.toPath())) {
        "PORTAL_BUILD_CONFIG must live outside the repository"
    }
    @Suppress("UNCHECKED_CAST")
    (JsonSlurper().parse(file) as Map<String, Any>)
}.orEmpty()
val cloudUrl = (buildConfig["base_url"] as? String
    ?: providers.gradleProperty("portalBaseUrl").orElse("").get()).trimEnd('/')
require(cloudUrl.isEmpty() || runCatching {
    val uri = URI(cloudUrl)
    uri.scheme == "https" && uri.host != null && uri.userInfo == null &&
        uri.query == null && uri.fragment == null && !cloudUrl.contains('"') && !cloudUrl.contains('\\')
}.getOrDefault(false)) {
    "portalBaseUrl must be a valid HTTPS URL without credentials, query, or fragment"
}
@Suppress("UNCHECKED_CAST")
val signing = (buildConfig["signing"] as? Map<String, String>).orEmpty()

android {
    namespace = "com.dapillah.gameportal"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.dapillah.gameportal"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        if (signing.isNotEmpty()) create("vm") {
            storeFile = file(signing.getValue("store_file")).canonicalFile.also {
                require(!it.toPath().startsWith(rootDir.parentFile.canonicalFile.toPath())) {
                    "The release keystore must live outside the repository"
                }
            }
            storePassword = signing.getValue("store_password")
            keyAlias = signing.getValue("key_alias")
            keyPassword = signing.getValue("key_password")
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["cleartext"] = "true"
            buildConfigField("String", "BASE_URL", "\"${cloudUrl.ifEmpty { "http://10.0.2.2:8000" }}/\"")
        }
        release {
            manifestPlaceholders["cleartext"] = "false"
            buildConfigField("String", "BASE_URL", "\"${cloudUrl.takeIf { it.isNotEmpty() }?.plus('/') ?: ""}\"")
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("vm")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

tasks.configureEach {
    if (name == "preReleaseBuild") doFirst {
        require(cloudUrl.isNotEmpty()) { "Supply -PportalBaseUrl=https://your-cloud-host for release" }
        require(signing.isNotEmpty()) { "Set PORTAL_BUILD_CONFIG to the private Android JSON configuration on the class VM" }
    }
}

// Stable handoff paths even when compiler outputs are outside a synced checkout.
listOf("Debug", "Release").forEach { variant ->
    val lower = variant.lowercase()
    val export = tasks.register<Copy>("export${variant}Apk") {
        from(layout.buildDirectory.file("outputs/apk/$lower/app-$lower.apk"))
        into(rootProject.file("artifacts"))
    }
    tasks.matching { it.name == "assemble$variant" }.configureEach { finalizedBy(export) }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.12.01"))
    implementation("androidx.activity:activity-compose:1.12.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:3.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.12.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
