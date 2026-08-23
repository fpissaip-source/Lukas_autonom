
export const db = new Proxy({}, { get: () => () => ({}) });
export const memoriesTable = {}; export const goalsTable = {}; export const diaryTable = {};
export const eq = () => ({});
export const logger = { warn() {}, info() {}, error() {} };

// Das Policy-Gate laesst hier alles durch; geprueft wird das Lesen, nicht die Freigabe.
export const checkPolicy = async () => ({ allow: true });
export const setMcpRiskTiers = () => {};

// Die eine Stelle, die der Test steuert: was GitHub antwortet.
export const githubRequest = async (pfad) => globalThis.__gh(pfad);
export const resolveGithubOwner = async (repo) => ({ owner: "issa", repo });
export const ownRepoRef = () => null;

export const MCP_TOOL_PREFIX = "mcp__";
export const activeServers = async () => [];
export const callMcpTool = async () => "";
export const ordneMcpWerkzeuge = (t) => t;
export const setLukasStatus = async () => {};
export const recordEmotion = async () => {};
export const queryRows = async () => [];
export const searchEmails = async () => []; export const readEmail = async () => "";
export const sendEmail = async () => "";
export const executeCommand = async () => ""; export const resetSandbox = async () => "";
export const executeOnHost = async () => "";
export const renderPage = async () => "";
export const createProposal = async () => ({});
export const runSubagent = async () => ""; export const subagentUebersicht = async () => "";
export const createSubagent = async () => ""; export const fixError = async () => "";
export const meldeDichBeiIssa = async () => "";
export const starteAnruf = async () => "";
export const fehlerGruppen = async () => [];
export const verbrauchsUebersicht = () => [];
