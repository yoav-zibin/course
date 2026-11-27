Pod::Spec.new do |s|
  s.name = 'LegacyPortal'
  s.version = '1.0.0'
  s.summary = 'BuildPlay native storage and launch settings'
  s.description = 'Stores game data in atomic files and supplies native UI test settings.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'BuildPlay'
  s.homepage = 'https://github.com/yoav-zibin/course'
  s.source = { :git => 'https://github.com/yoav-zibin/course.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-jsi'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20' }
  s.source_files = 'ios/*.{h,mm,swift}', 'cpp/*.h'
  s.public_header_files = 'ios/BPStorageWorklet.h'
  s.private_header_files = 'cpp/*.h'
  s.frameworks = 'CryptoKit'
end
