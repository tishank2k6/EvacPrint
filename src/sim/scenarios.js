// The four evacuation scenarios from the EvacPrint brief.
export const SCENARIOS = [
  {
    id: 'normal',
    name: 'Normal evacuation',
    short: 'Normal',
    summary: '200 occupants, all exits available, typical reaction times.',
    params: { occupants: 200, slowFraction: 0.05, wheelchairs: 0, reactionMin: 10, reactionMax: 30, panic: 0.2 },
    blocked: [],
  },
  {
    id: 'blocked',
    name: 'Blocked exit',
    short: 'Door B blocked',
    summary: 'Door B obstructed by stored equipment. Same 200 occupants must reroute.',
    params: { occupants: 200, slowFraction: 0.05, wheelchairs: 0, reactionMin: 10, reactionMax: 30, panic: 0.2 },
    blocked: ['Door B'],
  },
  {
    id: 'large',
    name: 'Larger crowd',
    short: '400 people',
    summary: 'Over-capacity event: 400 occupants, 60 of them standing in aisles.',
    params: { occupants: 400, slowFraction: 0.05, wheelchairs: 0, reactionMin: 10, reactionMax: 30, panic: 0.3 },
    blocked: [],
  },
  {
    id: 'mixed',
    name: 'Mixed mobility',
    short: 'Mixed crowd',
    summary: '250 occupants: 20 % reduced mobility and 4 wheelchair users.',
    params: { occupants: 250, slowFraction: 0.2, wheelchairs: 4, reactionMin: 10, reactionMax: 35, panic: 0.2 },
    blocked: [],
  },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
