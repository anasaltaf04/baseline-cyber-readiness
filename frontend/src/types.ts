export type Answer = 'yes' | 'partly' | 'no' | 'not_sure';

export interface Safeguard {
  id: string;
  title: string;
}

export interface Question {
  id: string;
  section: string;
  text: string;
  help: string;
  safeguards: Safeguard[];
}

export interface Section {
  id: string;
  title: string;
  blurb: string;
}

export interface QuestionBank {
  version: string;
  framework: string;
  framework_note: string;
  sections: Section[];
  questions: Question[];
}

export interface SectionScore {
  id: string;
  title: string;
  blurb: string;
  score: number;
  answered_well: number;
  question_count: number;
}

export interface Action {
  title: string;
  why_it_matters: string;
  steps: string[];
  estimated_cost: string;
  effort: 'low' | 'medium' | 'high';
  week: number;
}

export interface Plan {
  summary: string;
  source: 'bedrock' | 'fallback';
  top_actions: Action[];
}

export interface Profile {
  industry?: string;
  headcount?: number;
  business_name?: string;
}

export interface Report {
  id: string;
  created_at: string;
  score: number;
  band: { key: string; label: string; blurb: string };
  sections: SectionScore[];
  plan: Plan;
  profile: Profile;
  question_bank_version?: string;
}
