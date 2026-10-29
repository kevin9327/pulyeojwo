// index.html + css + js 모듈을 한 파일(dist/pulyeojwo.html)로 묶는다. file:// 로 열어도 동작(더블클릭 실행용).
// 사용: node build-single.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const order = ['glossary', 'engine', 'llm', 'agent', 'samples', 'recorded', 'app'];

let code = 'const __m = {};\n';
for (const name of order) {
  let src = read(`js/${name}.js`);
  const exportsList = [];
  src = src.replace(/^export\s+(const|let|function|async function|class)\s+([A-Za-z0-9_$]+)/gm, (_, kind, id) => { exportsList.push(id); return `${kind} ${id}`; });
  src = src.replace(/^import\s+\{([^}]+)\}\s+from\s+'\.\/([a-z]+)\.js';?\s*$/gm, (_, names, mod) => `const {${names.trim()}} = __m.${mod};`);
  code += `__m.${name} = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n`;
}
let html = read('index.html');
// 함수형 치환: 코드 안의 '$&' 같은 글자가 치환 패턴으로 해석되지 않게 한다
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${read('css/style.css')}\n</style>`);
html = html.replace('<script type="module" src="js/app.js"></script>', () => `<script type="module">\n${code}\n</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/pulyeojwo.html'), html);
console.log('dist/pulyeojwo.html', Math.round(html.length / 1024) + 'KB');
