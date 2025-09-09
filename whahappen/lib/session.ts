let selectedMode: string = 'global';
export const setSelectedMode = (m: string) => { selectedMode = m; };
export const getSelectedMode = () => selectedMode;

let recordedUri: string | null = null;
export const setRecordedUri = (uri: string | null) => { recordedUri = uri; };
export const getRecordedUri = () => recordedUri;

// 👉 nuevo: recuerda el ID del último post para priorizarlo en el feed
let lastSubmissionId: string | null = null;
export const setLastSubmissionId = (id: string | null) => { lastSubmissionId = id; };
export const getLastSubmissionId = () => lastSubmissionId;
