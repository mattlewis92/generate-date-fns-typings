'use strict';

const fs = require('fs');
const path = require('path');
const babylon = require('babylon');
const doctrine = require('doctrine');

function getDirectories(srcpath) {
  return fs.readdirSync(srcpath).filter(file => fs.statSync(path.join(srcpath, file)).isDirectory());
}

function docBlockTypeToTypescriptType(element) {
  if (element.expression && element.expression.name === 'Array') {
    return `${docBlockTypeToTypescriptType(element.applications[0])}[]`;
  }
  if (element.name === 'String' || element.name === 'Number' || element.name === 'Boolean') {
    return element.name.toLowerCase();
  }
  return element.name;
}

const SRC_DIR = path.join(__dirname, 'date-fns', 'src');

let fnDirs = getDirectories(SRC_DIR);

//fnDirs = [fnDirs[0]];

let mainModuleInner = '';
let separateModuleInner = '';

fnDirs.forEach(fnDir => {

  const fnFilePath = path.join(SRC_DIR, fnDir, 'index.js');
  const fnFileContents = fs.readFileSync(fnFilePath);
  const fnAst = babylon.parse(fnFileContents.toString());
  const fnName = fnAst.program.body.find(statement => {
    return (
      statement.type === 'ExpressionStatement' &&
      statement.expression.left &&
      statement.expression.left.object.name === 'module' &&
      statement.expression.left.property.name === 'exports'
    );
  }).expression.right.name;

  const docBlockString = fnAst.comments.find(comment => comment.type === 'CommentBlock').value;
  const docBlockTags = doctrine.parse(docBlockString, {unwrap: true, recoverable: true}).tags;

  const paramTags = docBlockTags.filter(tag => tag.title === 'param');
  const returnTag = docBlockTags.find(tag => tag.title === 'returns');

  const paramsString = paramTags.map(tag => {

    switch(tag.type.type) {

      case 'UnionType':
        const typeString = tag.type.elements.map(element => docBlockTypeToTypescriptType(element)).join(' | ');
        return `${tag.name}: ${typeString}`;
        break;

      case 'NameExpression':
        return `${tag.name}: ${docBlockTypeToTypescriptType(tag.type)}`;
        break;

      case 'AllLiteral':
      case 'RestType':
        return `${tag.name}: any`;

      default:
        console.log('Unknown type', tag);

    }

  }).join(', ');

  const typeScriptFnDefinition = `
  function ${fnName}(${paramsString}): ${docBlockTypeToTypescriptType(returnTag.type)};
  namespace ${fnName} {}
  `;

  mainModuleInner += typeScriptFnDefinition;

  separateModuleInner += `
declare module 'date-fns/${fnDir}' {
  import {${fnName}} from 'date-fns';
  export = ${fnName};
}
`;

});

const moduleFullString = `declare module 'date-fns' {
${mainModuleInner.trimRight()}

}
${separateModuleInner}
`;

fs.writeFileSync('./definitions.d.ts', moduleFullString);