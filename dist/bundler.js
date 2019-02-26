"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const globs = require("globs");
const Helpers = require("./helpers");
const IMPORT_PATTERN = /@import\s+['"](.+)['"];/g;
const COMMENT_PATTERN = /\/\/.*$/gm;
const MULTILINE_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const DEFAULT_FILE_EXTENSION = ".scss";
const ALLOWED_FILE_EXTENSIONS = [".scss", ".css"];
const NODE_MODULES = "node_modules";
const TILDE = "~";
class Bundler {
    constructor(fileRegistry = {}, projectDirectory) {
        this.fileRegistry = fileRegistry;
        this.projectDirectory = projectDirectory;
        // Full paths of used imports and their count
        this.usedImports = {};
        // Imports dictionary by file
        this.importsByFile = {};
    }
    BundleAll(files, dedupeGlobs = []) {
        return __awaiter(this, void 0, void 0, function* () {
            const resultsPromises = files.map((file) => __awaiter(this, void 0, void 0, function* () { return this.Bundle(file, dedupeGlobs); }));
            return Promise.all(resultsPromises);
        });
    }
    Bundle(file, dedupeGlobs = [], includePaths = [], ignoredImports = []) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.projectDirectory != null) {
                    file = path.resolve(this.projectDirectory, file);
                }
                yield fs.access(file);
                const contentPromise = fs.readFile(file, "utf-8");
                const dedupeFilesPromise = this.globFilesOrEmpty(dedupeGlobs);
                // Await all async operations and extract results
                const [content, dedupeFiles] = yield Promise.all([contentPromise, dedupeFilesPromise]);
                // Convert string array into regular expressions
                const ignoredImportsRegEx = ignoredImports.map(ignoredImport => new RegExp(ignoredImport));
                return this.bundle(file, content, dedupeFiles, includePaths, ignoredImportsRegEx);
            }
            catch (_a) {
                return {
                    filePath: file,
                    found: false
                };
            }
        });
    }
    isExtensionExists(importName) {
        return ALLOWED_FILE_EXTENSIONS.some((extension => importName.indexOf(extension) !== -1));
    }
    bundle(filePath, content, dedupeFiles, includePaths, ignoredImports) {
        return __awaiter(this, void 0, void 0, function* () {
            // Remove commented imports
            content = this.removeImportsFromComments(content);
            // Resolve path to work only with full paths
            filePath = path.resolve(filePath);
            const dirname = path.dirname(filePath);
            if (this.fileRegistry[filePath] == null) {
                this.fileRegistry[filePath] = content;
            }
            // Resolve imports file names (prepend underscore for partials)
            const importsPromises = Helpers.getAllMatches(content, IMPORT_PATTERN).map((match) => __awaiter(this, void 0, void 0, function* () {
                let importName = match[1];
                // Append extension if it's absent
                if (!this.isExtensionExists(importName)) {
                    importName += DEFAULT_FILE_EXTENSION;
                }
                // Determine if import should be ignored
                const ignored = ignoredImports.findIndex(ignoredImportRegex => ignoredImportRegex.test(importName)) !== -1;
                let fullPath;
                // Check for tilde import.
                const tilde = importName.startsWith(TILDE);
                if (tilde && this.projectDirectory != null) {
                    importName = `./${NODE_MODULES}/${importName.substr(TILDE.length, importName.length)}`;
                    fullPath = path.resolve(this.projectDirectory, importName);
                }
                else {
                    fullPath = path.resolve(dirname, importName);
                }
                const importData = {
                    importString: match[0],
                    tilde: tilde,
                    path: importName,
                    fullPath: fullPath,
                    found: false,
                    ignored: ignored
                };
                yield this.resolveImport(importData, includePaths);
                return importData;
            }));
            // Wait for all imports file names to be resolved
            const imports = yield Promise.all(importsPromises);
            const bundleResult = {
                filePath: filePath,
                found: true
            };
            const shouldCheckForDedupes = dedupeFiles != null && dedupeFiles.length > 0;
            // Bundle all imports
            const currentImports = [];
            for (const imp of imports) {
                let contentToReplace;
                let currentImport;
                // If neither import file, nor partial is found
                if (!imp.found) {
                    // Add empty bundle result with found: false
                    currentImport = {
                        filePath: imp.fullPath,
                        tilde: imp.tilde,
                        found: false,
                        ignored: imp.ignored
                    };
                }
                else if (this.fileRegistry[imp.fullPath] == null) {
                    // If file is not yet in the registry
                    // Read
                    const impContent = yield fs.readFile(imp.fullPath, "utf-8");
                    // and bundle it
                    const bundledImport = yield this.bundle(imp.fullPath, impContent, dedupeFiles, includePaths, ignoredImports);
                    // Then add its bundled content to the registry
                    this.fileRegistry[imp.fullPath] = bundledImport.bundledContent;
                    // Add it to used imports, if it's not there
                    if (this.usedImports != null && this.usedImports[imp.fullPath] == null) {
                        this.usedImports[imp.fullPath] = 1;
                    }
                    // And whole BundleResult to current imports
                    currentImport = bundledImport;
                }
                else {
                    // File is in the registry
                    // Increment it's usage count
                    if (this.usedImports != null) {
                        this.usedImports[imp.fullPath]++;
                    }
                    // Resolve child imports, if there are any
                    let childImports = [];
                    if (this.importsByFile != null) {
                        childImports = this.importsByFile[imp.fullPath];
                    }
                    // Construct and add result to current imports
                    currentImport = {
                        filePath: imp.fullPath,
                        tilde: imp.tilde,
                        found: true,
                        imports: childImports
                    };
                }
                if (imp.ignored) {
                    if (this.usedImports[imp.fullPath] > 1) {
                        contentToReplace = "";
                    }
                    else {
                        contentToReplace = imp.importString;
                    }
                }
                else {
                    // Take contentToReplace from the fileRegistry
                    contentToReplace = this.fileRegistry[imp.fullPath];
                    // If the content is not found
                    if (contentToReplace == null) {
                        // Indicate this with a comment for easier debugging
                        contentToReplace = `/*** IMPORTED FILE NOT FOUND ***/${os.EOL}${imp.importString}/*** --- ***/`;
                    }
                    // If usedImports dictionary is defined
                    if (shouldCheckForDedupes && this.usedImports != null) {
                        // And current import path should be deduped and is used already
                        const timesUsed = this.usedImports[imp.fullPath];
                        if (dedupeFiles.indexOf(imp.fullPath) !== -1 && timesUsed != null && timesUsed > 1) {
                            // Reset content to replace to an empty string to skip it
                            contentToReplace = "";
                            // And indicate that import was deduped
                            currentImport.deduped = true;
                        }
                    }
                }
                // Finally, replace import string with bundled content or a debug message
                content = this.replaceLastOccurance(content, imp.importString, contentToReplace);
                // And push current import into the list
                currentImports.push(currentImport);
            }
            // Set result properties
            bundleResult.bundledContent = content;
            bundleResult.imports = currentImports;
            if (this.importsByFile != null) {
                this.importsByFile[filePath] = currentImports;
            }
            return bundleResult;
        });
    }
    replaceLastOccurance(content, importString, contentToReplace) {
        const index = content.lastIndexOf(importString);
        return content.slice(0, index) + content.slice(index).replace(importString, contentToReplace);
    }
    removeImportsFromComments(text) {
        const patterns = [COMMENT_PATTERN, MULTILINE_COMMENT_PATTERN];
        for (const pattern of patterns) {
            text = text.replace(pattern, x => x.replace(IMPORT_PATTERN, ""));
        }
        return text;
    }
    resolveImport(importData, includePaths) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield fs.access(importData.fullPath);
                importData.found = true;
            }
            catch (error) {
                const underscoredDirname = path.dirname(importData.fullPath);
                const underscoredBasename = path.basename(importData.fullPath);
                const underscoredFilePath = path.join(underscoredDirname, `_${underscoredBasename}`);
                try {
                    yield fs.access(underscoredFilePath);
                    importData.fullPath = underscoredFilePath;
                    importData.found = true;
                }
                catch (underscoreErr) {
                    const cssFilePath = importData.fullPath.replace(/\.scss/g, '.css');
                    try {
                        yield fs.access(cssFilePath);
                        importData.fullPath = cssFilePath;
                        importData.found = true;
                    }
                    catch (cssErr) {
                        // If there are any includePaths
                        if (includePaths.length) {
                            // Resolve fullPath using its first entry
                            importData.fullPath = path.resolve(includePaths[0], importData.path);
                            // Try resolving import with the remaining includePaths
                            const remainingIncludePaths = includePaths.slice(1);
                            return this.resolveImport(importData, remainingIncludePaths);
                        }
                    }
                }
            }
            return importData;
        });
    }
    globFilesOrEmpty(globsList) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                if (globsList == null || globsList.length === 0) {
                    resolve([]);
                    return;
                }
                globs(globsList, (err, files) => {
                    // Reject if there's an error
                    if (err) {
                        reject(err);
                    }
                    // Resolve full paths
                    const result = files.map(file => path.resolve(file));
                    // Resolve promise
                    resolve(result);
                });
            });
        });
    }
}
exports.Bundler = Bundler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9idW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7QUFBQSwrQkFBK0I7QUFDL0IseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QiwrQkFBK0I7QUFFL0IscUNBQXFDO0FBRXJDLE1BQU0sY0FBYyxHQUFHLDBCQUEwQixDQUFDO0FBQ2xELE1BQU0sZUFBZSxHQUFHLFdBQVcsQ0FBQztBQUNwQyxNQUFNLHlCQUF5QixHQUFHLG1CQUFtQixDQUFDO0FBQ3RELE1BQU0sc0JBQXNCLEdBQUcsT0FBTyxDQUFDO0FBQ3ZDLE1BQU0sdUJBQXVCLEdBQUcsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDbEQsTUFBTSxZQUFZLEdBQUcsY0FBYyxDQUFDO0FBQ3BDLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQztBQTJCbEI7SUFNSSxZQUFvQixlQUE2QixFQUFFLEVBQW1CLGdCQUF5QjtRQUEzRSxpQkFBWSxHQUFaLFlBQVksQ0FBbUI7UUFBbUIscUJBQWdCLEdBQWhCLGdCQUFnQixDQUFTO1FBTC9GLDZDQUE2QztRQUNyQyxnQkFBVyxHQUE4QixFQUFFLENBQUM7UUFDcEQsNkJBQTZCO1FBQ3JCLGtCQUFhLEdBQXNDLEVBQUUsQ0FBQztJQUVxQyxDQUFDO0lBRXZGLFNBQVMsQ0FBQyxLQUFlLEVBQUUsY0FBd0IsRUFBRTs7WUFDOUQsTUFBTSxlQUFlLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFNLElBQUksRUFBQyxFQUFFLGdEQUFDLE9BQUEsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUEsR0FBQSxDQUFDLENBQUM7WUFDaEYsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQ3hDLENBQUM7S0FBQTtJQUVZLE1BQU0sQ0FDZixJQUFZLEVBQ1osY0FBd0IsRUFBRSxFQUMxQixlQUF5QixF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QUFDLENBQUMsQ0FBQztvQkFFckQsa0JBQWtCO29CQUNsQixPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQ3BCLENBQUMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQyxDQUFDLENBQUM7UUFDUCxDQUFDO0tBQUE7Q0FDSjtBQTNSRCwwQkEyUkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tIFwiZnMtZXh0cmFcIjtcclxuaW1wb3J0ICogYXMgb3MgZnJvbSBcIm9zXCI7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0ICogYXMgZ2xvYnMgZnJvbSBcImdsb2JzXCI7XHJcblxyXG5pbXBvcnQgKiBhcyBIZWxwZXJzIGZyb20gXCIuL2hlbHBlcnNcIjtcclxuXHJcbmNvbnN0IElNUE9SVF9QQVRURVJOID0gL0BpbXBvcnRcXHMrWydcIl0oLispWydcIl07L2c7XHJcbmNvbnN0IENPTU1FTlRfUEFUVEVSTiA9IC9cXC9cXC8uKiQvZ207XHJcbmNvbnN0IE1VTFRJTElORV9DT01NRU5UX1BBVFRFUk4gPSAvXFwvXFwqW1xcc1xcU10qP1xcKlxcLy9nO1xyXG5jb25zdCBERUZBVUxUX0ZJTEVfRVhURU5TSU9OID0gXCIuc2Nzc1wiO1xyXG5jb25zdCBBTExPV0VEX0ZJTEVfRVhURU5TSU9OUyA9IFtcIi5zY3NzXCIsIFwiLmNzc1wiXTtcclxuY29uc3QgTk9ERV9NT0RVTEVTID0gXCJub2RlX21vZHVsZXNcIjtcclxuY29uc3QgVElMREUgPSBcIn5cIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgRmlsZVJlZ2lzdHJ5IHtcclxuICAgIFtpZDogc3RyaW5nXTogc3RyaW5nIHwgdW5kZWZpbmVkO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEltcG9ydERhdGEge1xyXG4gICAgaW1wb3J0U3RyaW5nOiBzdHJpbmc7XHJcbiAgICB0aWxkZTogYm9vbGVhbjtcclxuICAgIHBhdGg6IHN0cmluZztcclxuICAgIGZ1bGxQYXRoOiBzdHJpbmc7XHJcbiAgICBmb3VuZDogYm9vbGVhbjtcclxuICAgIGlnbm9yZWQ/OiBib29sZWFuO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEJ1bmRsZVJlc3VsdCB7XHJcbiAgICAvLyBDaGlsZCBpbXBvcnRzIChpZiBhbnkpXHJcbiAgICBpbXBvcnRzPzogQnVuZGxlUmVzdWx0W107XHJcbiAgICB0aWxkZT86IGJvb2xlYW47XHJcbiAgICBkZWR1cGVkPzogYm9vbGVhbjtcclxuICAgIC8vIEZ1bGwgcGF0aCBvZiB0aGUgZmlsZVxyXG4gICAgZmlsZVBhdGg6IHN0cmluZztcclxuICAgIGJ1bmRsZWRDb250ZW50Pzogc3RyaW5nO1xyXG4gICAgZm91bmQ6IGJvb2xlYW47XHJcbiAgICBpZ25vcmVkPzogYm9vbGVhbjtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIEJ1bmRsZXIge1xyXG4gICAgLy8gRnVsbCBwYXRocyBvZiB1c2VkIGltcG9ydHMgYW5kIHRoZWlyIGNvdW50XHJcbiAgICBwcml2YXRlIHVzZWRJbXBvcnRzOiB7IFtrZXk6IHN0cmluZ106IG51bWJlciB9ID0ge307XHJcbiAgICAvLyBJbXBvcnRzIGRpY3Rpb25hcnkgYnkgZmlsZVxyXG4gICAgcHJpdmF0ZSBpbXBvcnRzQnlGaWxlOiB7IFtrZXk6IHN0cmluZ106IEJ1bmRsZVJlc3VsdFtdIH0gPSB7fTtcclxuXHJcbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIGZpbGVSZWdpc3RyeTogRmlsZVJlZ2lzdHJ5ID0ge30sIHByaXZhdGUgcmVhZG9ubHkgcHJvamVjdERpcmVjdG9yeT86IHN0cmluZykgeyB9XHJcblxyXG4gICAgcHVibGljIGFzeW5jIEJ1bmRsZUFsbChmaWxlczogc3RyaW5nW10sIGRlZHVwZUdsb2JzOiBzdHJpbmdbXSA9IFtdKTogUHJvbWlzZTxCdW5kbGVSZXN1bHRbXT4ge1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdHNQcm9taXNlcyA9IGZpbGVzLm1hcChhc3luYyBmaWxlID0+IHRoaXMuQnVuZGxlKGZpbGUsIGRlZHVwZUdsb2JzKSk7XHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHJlc3VsdHNQcm9taXNlcyk7XHJcbiAgICB9XHJcblxyXG4gICAgcHVibGljIGFzeW5jIEJ1bmRsZShcclxuICAgICAgICBmaWxlOiBzdHJpbmcsXHJcbiAgICAgICAgZGVkdXBlR2xvYnM6IHN0cmluZ1tdID0gW10sXHJcbiAgICAgICAgaW5jbHVkZVBhdGhzOiBzdHJpbmdbXSA9IFtdLFxyXG4gICAgICAgIGlnbm9yZWRJbXBvcnRzOiBzdHJpbmdbXSA9IFtdXHJcbiAgICApOiBQcm9taXNlPEJ1bmRsZVJlc3VsdD4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLnByb2plY3REaXJlY3RvcnkgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgZmlsZSA9IHBhdGgucmVzb2x2ZSh0aGlzLnByb2plY3REaXJlY3RvcnksIGZpbGUpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBhd2FpdCBmcy5hY2Nlc3MoZmlsZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRQcm9taXNlID0gZnMucmVhZEZpbGUoZmlsZSwgXCJ1dGYtOFwiKTtcclxuICAgICAgICAgICAgY29uc3QgZGVkdXBlRmlsZXNQcm9taXNlID0gdGhpcy5nbG9iRmlsZXNPckVtcHR5KGRlZHVwZUdsb2JzKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEF3YWl0IGFsbCBhc3luYyBvcGVyYXRpb25zIGFuZCBleHRyYWN0IHJlc3VsdHNcclxuICAgICAgICAgICAgY29uc3QgW2NvbnRlbnQsIGRlZHVwZUZpbGVzXSA9IGF3YWl0IFByb21pc2UuYWxsKFtjb250ZW50UHJvbWlzZSwgZGVkdXBlRmlsZXNQcm9taXNlXSk7XHJcblxyXG4gICAgICAgICAgICAvLyBDb252ZXJ0IHN0cmluZyBhcnJheSBpbnRvIHJlZ3VsYXIgZXhwcmVzc2lvbnNcclxuICAgICAgICAgICAgY29uc3QgaWdub3JlZEltcG9ydHNSZWdFeCA9IGlnbm9yZWRJbXBvcnRzLm1hcChpZ25vcmVkSW1wb3J0ID0+IG5ldyBSZWdFeHAoaWdub3JlZEltcG9ydCkpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuYnVuZGxlKGZpbGUsIGNvbnRlbnQsIGRlZHVwZUZpbGVzLCBpbmNsdWRlUGF0aHMsIGlnbm9yZWRJbXBvcnRzUmVnRXgpO1xyXG4gICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGg6IGZpbGUsXHJcbiAgICAgICAgICAgICAgICBmb3VuZDogZmFsc2VcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBpc0V4dGVuc2lvbkV4aXN0cyhpbXBvcnROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgICAgICByZXR1cm4gQUxMT1dFRF9GSUxFX0VYVEVOU0lPTlMuc29tZSgoZXh0ZW5zaW9uID0+IGltcG9ydE5hbWUuaW5kZXhPZihleHRlbnNpb24pICE9PSAtMSkpO1xyXG4gICAgfVxyXG4gICAgcHJpdmF0ZSBhc3luYyBidW5kbGUoXHJcbiAgICAgICAgZmlsZVBhdGg6IHN0cmluZyxcclxuICAgICAgICBjb250ZW50OiBzdHJpbmcsXHJcbiAgICAgICAgZGVkdXBlRmlsZXM6IHN0cmluZ1tdLFxyXG4gICAgICAgIGluY2x1ZGVQYXRoczogc3RyaW5nW10sXHJcbiAgICAgICAgaWdub3JlZEltcG9ydHM6IFJlZ0V4cFtdXHJcbiAgICApOiBQcm9taXNlPEJ1bmRsZVJlc3VsdD4ge1xyXG4gICAgICAgIC8vIFJlbW92ZSBjb21tZW50ZWQgaW1wb3J0c1xyXG4gICAgICAgIGNvbnRlbnQgPSB0aGlzLnJlbW92ZUltcG9ydHNGcm9tQ29tbWVudHMoY29udGVudCk7XHJcblxyXG4gICAgICAgIC8vIFJlc29sdmUgcGF0aCB0byB3b3JrIG9ubHkgd2l0aCBmdWxsIHBhdGhzXHJcbiAgICAgICAgZmlsZVBhdGggPSBwYXRoLnJlc29sdmUoZmlsZVBhdGgpO1xyXG5cclxuICAgICAgICBjb25zdCBkaXJuYW1lID0gcGF0aC5kaXJuYW1lKGZpbGVQYXRoKTtcclxuXHJcbiAgICAgICAgaWYgKHRoaXMuZmlsZVJlZ2lzdHJ5W2ZpbGVQYXRoXSA9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRoaXMuZmlsZVJlZ2lzdHJ5W2ZpbGVQYXRoXSA9IGNvbnRlbnQ7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBSZXNvbHZlIGltcG9ydHMgZmlsZSBuYW1lcyAocHJlcGVuZCB1bmRlcnNjb3JlIGZvciBwYXJ0aWFscylcclxuICAgICAgICBjb25zdCBpbXBvcnRzUHJvbWlzZXMgPSBIZWxwZXJzLmdldEFsbE1hdGNoZXMoY29udGVudCwgSU1QT1JUX1BBVFRFUk4pLm1hcChhc3luYyBtYXRjaCA9PiB7XHJcbiAgICAgICAgICAgIGxldCBpbXBvcnROYW1lID0gbWF0Y2hbMV07XHJcbiAgICAgICAgICAgIC8vIEFwcGVuZCBleHRlbnNpb24gaWYgaXQncyBhYnNlbnRcclxuICAgICAgICAgICAgaWYgKCF0aGlzLmlzRXh0ZW5zaW9uRXhpc3RzKGltcG9ydE5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICBpbXBvcnROYW1lICs9IERFRkFVTFRfRklMRV9FWFRFTlNJT047XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIERldGVybWluZSBpZiBpbXBvcnQgc2hvdWxkIGJlIGlnbm9yZWRcclxuICAgICAgICAgICAgY29uc3QgaWdub3JlZCA9IGlnbm9yZWRJbXBvcnRzLmZpbmRJbmRleChpZ25vcmVkSW1wb3J0UmVnZXggPT4gaWdub3JlZEltcG9ydFJlZ2V4LnRlc3QoaW1wb3J0TmFtZSkpICE9PSAtMTtcclxuXHJcbiAgICAgICAgICAgIGxldCBmdWxsUGF0aDogc3RyaW5nO1xyXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgdGlsZGUgaW1wb3J0LlxyXG4gICAgICAgICAgICBjb25zdCB0aWxkZTogYm9vbGVhbiA9IGltcG9ydE5hbWUuc3RhcnRzV2l0aChUSUxERSk7XHJcbiAgICAgICAgICAgIGlmICh0aWxkZSAmJiB0aGlzLnByb2plY3REaXJlY3RvcnkgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgaW1wb3J0TmFtZSA9IGAuLyR7Tk9ERV9NT0RVTEVTfS8ke2ltcG9ydE5hbWUuc3Vic3RyKFRJTERFLmxlbmd0aCwgaW1wb3J0TmFtZS5sZW5ndGgpfWA7XHJcbiAgICAgICAgICAgICAgICBmdWxsUGF0aCA9IHBhdGgucmVzb2x2ZSh0aGlzLnByb2plY3REaXJlY3RvcnksIGltcG9ydE5hbWUpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgZnVsbFBhdGggPSBwYXRoLnJlc29sdmUoZGlybmFtZSwgaW1wb3J0TmFtZSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGltcG9ydERhdGE6IEltcG9ydERhdGEgPSB7XHJcbiAgICAgICAgICAgICAgICBpbXBvcnRTdHJpbmc6IG1hdGNoWzBdLFxyXG4gICAgICAgICAgICAgICAgdGlsZGU6IHRpbGRlLFxyXG4gICAgICAgICAgICAgICAgcGF0aDogaW1wb3J0TmFtZSxcclxuICAgICAgICAgICAgICAgIGZ1bGxQYXRoOiBmdWxsUGF0aCxcclxuICAgICAgICAgICAgICAgIGZvdW5kOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGlnbm9yZWQ6IGlnbm9yZWRcclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVzb2x2ZUltcG9ydChpbXBvcnREYXRhLCBpbmNsdWRlUGF0aHMpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIGltcG9ydERhdGE7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIFdhaXQgZm9yIGFsbCBpbXBvcnRzIGZpbGUgbmFtZXMgdG8gYmUgcmVzb2x2ZWRcclxuICAgICAgICBjb25zdCBpbXBvcnRzID0gYXdhaXQgUHJvbWlzZS5hbGwoaW1wb3J0c1Byb21pc2VzKTtcclxuXHJcbiAgICAgICAgY29uc3QgYnVuZGxlUmVzdWx0OiBCdW5kbGVSZXN1bHQgPSB7XHJcbiAgICAgICAgICAgIGZpbGVQYXRoOiBmaWxlUGF0aCxcclxuICAgICAgICAgICAgZm91bmQ6IHRydWVcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zdCBzaG91bGRDaGVja0ZvckRlZHVwZXMgPSBkZWR1cGVGaWxlcyAhPSBudWxsICYmIGRlZHVwZUZpbGVzLmxlbmd0aCA+IDA7XHJcblxyXG4gICAgICAgIC8vIEJ1bmRsZSBhbGwgaW1wb3J0c1xyXG4gICAgICAgIGNvbnN0IGN1cnJlbnRJbXBvcnRzOiBCdW5kbGVSZXN1bHRbXSA9IFtdO1xyXG4gICAgICAgIGZvciAoY29uc3QgaW1wIG9mIGltcG9ydHMpIHtcclxuICAgICAgICAgICAgbGV0IGNvbnRlbnRUb1JlcGxhY2U7XHJcblxyXG4gICAgICAgICAgICBsZXQgY3VycmVudEltcG9ydDogQnVuZGxlUmVzdWx0O1xyXG5cclxuICAgICAgICAgICAgLy8gSWYgbmVpdGhlciBpbXBvcnQgZmlsZSwgbm9yIHBhcnRpYWwgaXMgZm91bmRcclxuICAgICAgICAgICAgaWYgKCFpbXAuZm91bmQpIHtcclxuICAgICAgICAgICAgICAgIC8vIEFkZCBlbXB0eSBidW5kbGUgcmVzdWx0IHdpdGggZm91bmQ6IGZhbHNlXHJcbiAgICAgICAgICAgICAgICBjdXJyZW50SW1wb3J0ID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoOiBpbXAuZnVsbFBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgdGlsZGU6IGltcC50aWxkZSxcclxuICAgICAgICAgICAgICAgICAgICBmb3VuZDogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgaWdub3JlZDogIGltcC5pZ25vcmVkXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZmlsZVJlZ2lzdHJ5W2ltcC5mdWxsUGF0aF0gPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgLy8gSWYgZmlsZSBpcyBub3QgeWV0IGluIHRoZSByZWdpc3RyeVxyXG4gICAgICAgICAgICAgICAgLy8gUmVhZFxyXG4gICAgICAgICAgICAgICAgY29uc3QgaW1wQ29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKGltcC5mdWxsUGF0aCwgXCJ1dGYtOFwiKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBhbmQgYnVuZGxlIGl0XHJcbiAgICAgICAgICAgICAgICBjb25zdCBidW5kbGVkSW1wb3J0ID0gYXdhaXQgdGhpcy5idW5kbGUoaW1wLmZ1bGxQYXRoLCBpbXBDb250ZW50LCBkZWR1cGVGaWxlcywgaW5jbHVkZVBhdGhzLCBpZ25vcmVkSW1wb3J0cyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gVGhlbiBhZGQgaXRzIGJ1bmRsZWQgY29udGVudCB0byB0aGUgcmVnaXN0cnlcclxuICAgICAgICAgICAgICAgIHRoaXMuZmlsZVJlZ2lzdHJ5W2ltcC5mdWxsUGF0aF0gPSBidW5kbGVkSW1wb3J0LmJ1bmRsZWRDb250ZW50O1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIEFkZCBpdCB0byB1c2VkIGltcG9ydHMsIGlmIGl0J3Mgbm90IHRoZXJlXHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy51c2VkSW1wb3J0cyAhPSBudWxsICYmIHRoaXMudXNlZEltcG9ydHNbaW1wLmZ1bGxQYXRoXSA9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy51c2VkSW1wb3J0c1tpbXAuZnVsbFBhdGhdID0gMTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBBbmQgd2hvbGUgQnVuZGxlUmVzdWx0IHRvIGN1cnJlbnQgaW1wb3J0c1xyXG4gICAgICAgICAgICAgICAgY3VycmVudEltcG9ydCA9IGJ1bmRsZWRJbXBvcnQ7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBGaWxlIGlzIGluIHRoZSByZWdpc3RyeVxyXG4gICAgICAgICAgICAgICAgLy8gSW5jcmVtZW50IGl0J3MgdXNhZ2UgY291bnRcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLnVzZWRJbXBvcnRzICE9IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnVzZWRJbXBvcnRzW2ltcC5mdWxsUGF0aF0rKztcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBSZXNvbHZlIGNoaWxkIGltcG9ydHMsIGlmIHRoZXJlIGFyZSBhbnlcclxuICAgICAgICAgICAgICAgIGxldCBjaGlsZEltcG9ydHM6IEJ1bmRsZVJlc3VsdFtdID0gW107XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5pbXBvcnRzQnlGaWxlICE9IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICBjaGlsZEltcG9ydHMgPSB0aGlzLmltcG9ydHNCeUZpbGVbaW1wLmZ1bGxQYXRoXTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBDb25zdHJ1Y3QgYW5kIGFkZCByZXN1bHQgdG8gY3VycmVudCBpbXBvcnRzXHJcbiAgICAgICAgICAgICAgICBjdXJyZW50SW1wb3J0ID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoOiBpbXAuZnVsbFBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgdGlsZGU6IGltcC50aWxkZSxcclxuICAgICAgICAgICAgICAgICAgICBmb3VuZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBpbXBvcnRzOiBjaGlsZEltcG9ydHNcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChpbXAuaWdub3JlZCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMudXNlZEltcG9ydHNbaW1wLmZ1bGxQYXRoXSA+IDEpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb250ZW50VG9SZXBsYWNlID0gXCJcIjtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGVudFRvUmVwbGFjZSA9IGltcC5pbXBvcnRTdHJpbmc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gVGFrZSBjb250ZW50VG9SZXBsYWNlIGZyb20gdGhlIGZpbGVSZWdpc3RyeVxyXG4gICAgICAgICAgICAgICAgY29udGVudFRvUmVwbGFjZSA9IHRoaXMuZmlsZVJlZ2lzdHJ5W2ltcC5mdWxsUGF0aF07XHJcbiAgICAgICAgICAgICAgICAvLyBJZiB0aGUgY29udGVudCBpcyBub3QgZm91bmRcclxuICAgICAgICAgICAgICAgIGlmIChjb250ZW50VG9SZXBsYWNlID09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBJbmRpY2F0ZSB0aGlzIHdpdGggYSBjb21tZW50IGZvciBlYXNpZXIgZGVidWdnaW5nXHJcbiAgICAgICAgICAgICAgICAgICAgY29udGVudFRvUmVwbGFjZSA9IGAvKioqIElNUE9SVEVEIEZJTEUgTk9UIEZPVU5EICoqKi8ke29zLkVPTH0ke2ltcC5pbXBvcnRTdHJpbmd9LyoqKiAtLS0gKioqL2A7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gSWYgdXNlZEltcG9ydHMgZGljdGlvbmFyeSBpcyBkZWZpbmVkXHJcbiAgICAgICAgICAgICAgICBpZiAoc2hvdWxkQ2hlY2tGb3JEZWR1cGVzICYmIHRoaXMudXNlZEltcG9ydHMgIT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIEFuZCBjdXJyZW50IGltcG9ydCBwYXRoIHNob3VsZCBiZSBkZWR1cGVkIGFuZCBpcyB1c2VkIGFscmVhZHlcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0aW1lc1VzZWQgPSB0aGlzLnVzZWRJbXBvcnRzW2ltcC5mdWxsUGF0aF07XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRlZHVwZUZpbGVzLmluZGV4T2YoaW1wLmZ1bGxQYXRoKSAhPT0gLTEgJiYgdGltZXNVc2VkICE9IG51bGwgJiYgdGltZXNVc2VkID4gMSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZXNldCBjb250ZW50IHRvIHJlcGxhY2UgdG8gYW4gZW1wdHkgc3RyaW5nIHRvIHNraXAgaXRcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudFRvUmVwbGFjZSA9IFwiXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFuZCBpbmRpY2F0ZSB0aGF0IGltcG9ydCB3YXMgZGVkdXBlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50SW1wb3J0LmRlZHVwZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gRmluYWxseSwgcmVwbGFjZSBpbXBvcnQgc3RyaW5nIHdpdGggYnVuZGxlZCBjb250ZW50IG9yIGEgZGVidWcgbWVzc2FnZVxyXG4gICAgICAgICAgICBjb250ZW50ID0gdGhpcy5yZXBsYWNlTGFzdE9jY3VyYW5jZShjb250ZW50LCBpbXAuaW1wb3J0U3RyaW5nLCBjb250ZW50VG9SZXBsYWNlKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEFuZCBwdXNoIGN1cnJlbnQgaW1wb3J0IGludG8gdGhlIGxpc3RcclxuICAgICAgICAgICAgY3VycmVudEltcG9ydHMucHVzaChjdXJyZW50SW1wb3J0KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFNldCByZXN1bHQgcHJvcGVydGllc1xyXG4gICAgICAgIGJ1bmRsZVJlc3VsdC5idW5kbGVkQ29udGVudCA9IGNvbnRlbnQ7XHJcbiAgICAgICAgYnVuZGxlUmVzdWx0LmltcG9ydHMgPSBjdXJyZW50SW1wb3J0cztcclxuXHJcbiAgICAgICAgaWYgKHRoaXMuaW1wb3J0c0J5RmlsZSAhPSBudWxsKSB7XHJcbiAgICAgICAgICAgIHRoaXMuaW1wb3J0c0J5RmlsZVtmaWxlUGF0aF0gPSBjdXJyZW50SW1wb3J0cztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBidW5kbGVSZXN1bHQ7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZXBsYWNlTGFzdE9jY3VyYW5jZShjb250ZW50OiBzdHJpbmcsIGltcG9ydFN0cmluZzogc3RyaW5nLCBjb250ZW50VG9SZXBsYWNlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgICAgIGNvbnN0IGluZGV4ID0gY29udGVudC5sYXN0SW5kZXhPZihpbXBvcnRTdHJpbmcpO1xyXG4gICAgICAgIHJldHVybiBjb250ZW50LnNsaWNlKDAsIGluZGV4KSArIGNvbnRlbnQuc2xpY2UoaW5kZXgpLnJlcGxhY2UoaW1wb3J0U3RyaW5nLCBjb250ZW50VG9SZXBsYWNlKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIHJlbW92ZUltcG9ydHNGcm9tQ29tbWVudHModGV4dDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBwYXR0ZXJucyA9IFtDT01NRU5UX1BBVFRFUk4sIE1VTFRJTElORV9DT01NRU5UX1BBVFRFUk5dO1xyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcclxuICAgICAgICAgICAgdGV4dCA9IHRleHQucmVwbGFjZShwYXR0ZXJuLCB4ID0+IHgucmVwbGFjZShJTVBPUlRfUEFUVEVSTiwgXCJcIikpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHRleHQ7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyByZXNvbHZlSW1wb3J0KGltcG9ydERhdGEsIGluY2x1ZGVQYXRocyk6IFByb21pc2U8YW55PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgZnMuYWNjZXNzKGltcG9ydERhdGEuZnVsbFBhdGgpO1xyXG4gICAgICAgICAgICBpbXBvcnREYXRhLmZvdW5kID0gdHJ1ZTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zdCB1bmRlcnNjb3JlZERpcm5hbWUgPSBwYXRoLmRpcm5hbWUoaW1wb3J0RGF0YS5mdWxsUGF0aCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHVuZGVyc2NvcmVkQmFzZW5hbWUgPSBwYXRoLmJhc2VuYW1lKGltcG9ydERhdGEuZnVsbFBhdGgpO1xyXG4gICAgICAgICAgICBjb25zdCB1bmRlcnNjb3JlZEZpbGVQYXRoID0gcGF0aC5qb2luKHVuZGVyc2NvcmVkRGlybmFtZSwgYF8ke3VuZGVyc2NvcmVkQmFzZW5hbWV9YCk7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBmcy5hY2Nlc3ModW5kZXJzY29yZWRGaWxlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICBpbXBvcnREYXRhLmZ1bGxQYXRoID0gdW5kZXJzY29yZWRGaWxlUGF0aDtcclxuICAgICAgICAgICAgICAgIGltcG9ydERhdGEuZm91bmQgPSB0cnVlO1xyXG4gICAgICAgICAgICB9IGNhdGNoICh1bmRlcnNjb3JlRXJyKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjc3NGaWxlUGF0aCA9IGltcG9ydERhdGEuZnVsbFBhdGgucmVwbGFjZSgvXFwuc2Nzcy9nLCAnLmNzcycpO1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5hY2Nlc3MoY3NzRmlsZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGltcG9ydERhdGEuZnVsbFBhdGggPSBjc3NGaWxlUGF0aDtcclxuICAgICAgICAgICAgICAgICAgICBpbXBvcnREYXRhLmZvdW5kID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNhdGNoKGNzc0Vycikge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgaW5jbHVkZVBhdGhzXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluY2x1ZGVQYXRocy5sZW5ndGgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVzb2x2ZSBmdWxsUGF0aCB1c2luZyBpdHMgZmlyc3QgZW50cnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgaW1wb3J0RGF0YS5mdWxsUGF0aCA9IHBhdGgucmVzb2x2ZShpbmNsdWRlUGF0aHNbMF0sIGltcG9ydERhdGEucGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyeSByZXNvbHZpbmcgaW1wb3J0IHdpdGggdGhlIHJlbWFpbmluZyBpbmNsdWRlUGF0aHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nSW5jbHVkZVBhdGhzID0gaW5jbHVkZVBhdGhzLnNsaWNlKDEpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlSW1wb3J0KGltcG9ydERhdGEsIHJlbWFpbmluZ0luY2x1ZGVQYXRocyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gaW1wb3J0RGF0YTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGdsb2JGaWxlc09yRW1wdHkoZ2xvYnNMaXN0OiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2U8c3RyaW5nW10+KChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgaWYgKGdsb2JzTGlzdCA9PSBudWxsIHx8IGdsb2JzTGlzdC5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoW10pO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGdsb2JzKGdsb2JzTGlzdCwgKGVycjogRXJyb3IsIGZpbGVzOiBzdHJpbmdbXSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gUmVqZWN0IGlmIHRoZXJlJ3MgYW4gZXJyb3JcclxuICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyKTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBSZXNvbHZlIGZ1bGwgcGF0aHNcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbGVzLm1hcChmaWxlID0+IHBhdGgucmVzb2x2ZShmaWxlKSk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gUmVzb2x2ZSBwcm9taXNlXHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG59XHJcbiJdfQ==