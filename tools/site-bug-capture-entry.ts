import {captureBugScreenshot} from '../frontends/portal/src/platform/screenshot.web';

(window as any).SiteBugReporter?.registerCapture(captureBugScreenshot);
