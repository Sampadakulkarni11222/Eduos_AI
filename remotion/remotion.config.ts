import { Config } from '@remotion/cli/config';

// Captures, logo and audio live in ./assets and are referenced with staticFile().
Config.setPublicDir('./assets');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setConcurrency(4);
