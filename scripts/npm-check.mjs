const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error('LUKAS benötigt Node.js 20 oder neuer.');
  process.exit(1);
}
console.log(`Node ${process.version} erkannt. npm-Workspace ist bereit.`);
