export const miniReport = [
  [
    "index.html",
    "text/html",
    '<!doctype html><link rel="stylesheet" href="assets/style.css"><script src="assets/app.js"></script><img src="images/example.png">',
  ],
  [
    "assets/app.js",
    "application/javascript",
    'fetch("data/result.json").then(r=>r.json())',
  ],
  ["assets/style.css", "text/css", "body{color:green}"],
  ["data/result.json", "application/json", '{"passed":true}'],
  ["images/example.png", "image/png", "tiny-binary-fixture"],
] as const;
