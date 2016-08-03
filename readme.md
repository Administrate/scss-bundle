scss-bundle
===========

## Get started
```sh
$ npm install scss-bundle -g
```

## Features
- Bundles all SCSS files through import to one file.

## Usage
```sh
$ scss-bundle -h
```

### Examples
_Using config:_
```sh
$ scss-bundle -c scss-bundle.config.json
```
_Without config:_

Without config `entry` and `dest` arguments are required.
```sh
$ scss-bundle -e ./src/main.scss -d bundled.scss
```

## Config example
```json
{
    "entry": "./src/main.scss",
    "dest": "bundled.scss"
}
```

| Argument | Type   | Description                              |
|----------|--------|------------------------------------------|
| entry`*` | string | Main entry file where to start bundling. |
| dest`*`  | string | Destination file when bundling is done.  |

`*` - Required

## License
Released under the [PGL-3.0 license](LICENSE).