Pod::Spec.new do |s|
  s.name = 'BuildPlayRuntime'
  s.version = '1.0.0'
  s.summary = 'Bounded isolated game JavaScript execution'
  s.description = 'QuickJS game execution with isolated JSON-only contexts and execution limits.'
  s.author = 'BuildPlay'
  s.homepage = 'https://github.com/yoav-zibin/course'
  s.license = { :type => 'MIT' }
  s.source = { :git => 'https://github.com/yoav-zibin/course.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/**/*.swift', 'cpp/*.{c,h}', 'cpp/quickjs/*.{c,h}'
  s.public_header_files = 'cpp/buildplay_runtime.h'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) _GNU_SOURCE CONFIG_VERSION="\\"2025-09-13\\""',
    'CLANG_C_LANGUAGE_STANDARD' => 'gnu11'
  }
end
