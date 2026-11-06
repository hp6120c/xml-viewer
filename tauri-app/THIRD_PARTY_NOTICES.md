# Third-Party Notices

This application includes or interoperates with the following open-source
projects. Their licenses remain in effect.

## MarkText and Muya

- MarkText: https://github.com/marktext/marktext
- Muya (`@muyajs/core` 0.2.0): https://github.com/marktext/muya
- License: MIT
- Copyright (c) 2018-present Luo Ran

The WYSIWYG Markdown editing engine is provided by `@muyajs/core`. The
application-specific toolbar, file handling, file associations, update flow,
and resource handling are maintained by this project.

```text
MIT License

Copyright (c) 2018-present Luo Ran

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Papa Parse

- Papa Parse (`papaparse` 5.5.3): https://github.com/mholt/PapaParse
- License: MIT
- Copyright (c) 2015 Matthew Holt

The CSV parser and serializer used by the table editor is provided by Papa
Parse.

```text
MIT License

Copyright (c) 2015 Matthew Holt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled rendering dependencies

Muya bundles additional open-source libraries, including KaTeX, Mermaid,
Prism, Vega, Vega-Lite, Snabbdom, Turndown, DOMPurify, and their transitive
dependencies. Their package versions and license metadata are recorded in
`package-lock.json` and in the corresponding packages under `node_modules`
when preparing a source build. Release artifacts must retain this notice
alongside the installed application.
