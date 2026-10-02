// Compact authoring helpers for the demo seed. Blocks: T text, N teacher note, Q question, R library resource.
export const T = text => ({ kind: "text", text });
export const N = text => ({ kind: "teacher-note", text });
export const Q = (text, options, answer) => ({ kind: "question", text, options, answer });
export const R = resourceId => ({ kind: "resource", resourceId });
/** An activity in a moment of the lesson's sequence. */
export const A = (phase, title, minutes, purpose, grouping, blocks) => ({ phase, title, minutes, purpose, grouping, blocks });
/** A lesson. options: published (ISO date) · by (author) · changes (an activity added after publishing). */
export const L = (id, title, objective, duration, sequence, outcomeIds, activities, options = {}) => ({ id, title, objective, duration, sequence, outcomeIds, activities, ...options });
