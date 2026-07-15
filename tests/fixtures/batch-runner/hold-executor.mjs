let serialized = "";
for await (const chunk of process.stdin) serialized += chunk;
JSON.parse(serialized);
await new Promise((resolve) => setTimeout(resolve, 400));
process.stdout.write(JSON.stringify({
  outcome: "blocked",
  stage: "compatibility",
  failureClass: "synthetic-lock-holder",
  evidence: {},
}));
