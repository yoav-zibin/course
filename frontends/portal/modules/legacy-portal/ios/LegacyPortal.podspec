Pod::Spec.new do |s|
  s.name = 'LegacyPortal'
  s.version = '1.0.0'
  s.summary = 'Read-only upgrade access to the original BuildPlay app data'
  s.description = 'Exports existing local accounts and archived matches without replaying old moves.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'BuildPlay'
  s.homepage = 'https://github.com/yoav-zibin/course'
  s.source = { :git => 'https://github.com/yoav-zibin/course.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.frameworks = 'Security', 'CryptoKit'
end
