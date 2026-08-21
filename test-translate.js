const https = require('https');
function translate(text, target) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json[0].map(x => x[0]).join(''));
        } catch(e) {
          resolve("ERROR");
        }
      });
    });
  });
}
translate("Привет мир! Как дела?", "en").then(console.log);
