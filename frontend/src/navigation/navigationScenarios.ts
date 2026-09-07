export interface NavigationScenario {
  name: string;
  description: string;
  expected: string[];
}

export const NAVIGATION_SCENARIOS: NavigationScenario[] = [
  { name: 'Urban right turn', description: 'Three-lane urban approach with right-turn pocket', expected: ['right lane preferred', 'no false reroute from 10m GPS lateral noise'] },
  { name: 'Highway fork', description: 'Fast approach to a multi-lane fork', expected: ['early prepare phase', 'lane movement warning before 120m'] },
  { name: 'Roundabout', description: 'Complex roundabout with exit decision', expected: ['immersive preview', 'monotonic maneuver progression'] },
  { name: 'GPS dropout', description: '8–12 second location gap', expected: ['hold last trusted position', 'recover without restarting trip'] },
  { name: 'Offline route', description: 'Network loss after route start', expected: ['keep route visible', 'preserve cached navigation session'] },
];
