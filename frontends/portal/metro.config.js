const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const defaultOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (entries, options, getDependencies) => {
  const result = await defaultOptions(entries, options, getDependencies);
  if (options.platform !== 'ios' || options.dev) return result;
  return {...result, transform: {...result.transform, inlineRequires: true}};
};
module.exports = config;
