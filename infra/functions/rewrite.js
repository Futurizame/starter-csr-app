// CloudFront viewer-request function.
//
// React Router's prerender writes /items -> items/index.html, so extensionless
// paths must be rewritten before they reach S3. Paths that do not exist fall
// through to the SPA fallback via the distribution's error responses.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (!uri.includes(".")) {
    request.uri = uri + "/index.html";
  }

  return request;
}
