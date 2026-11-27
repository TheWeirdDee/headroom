// The situations Headroom's participants react to, as Mozaik specifications. Mozaik asks every joined
// participant's specifications about every event; these decide who acts. Compose them with and/or/not.
import { SituationSpecification, type SituationContext } from '@mozaik-ai/core';
import { parseKey, type ParsedKey } from '../domain/keys.ts';
import type { HeadroomState } from '../runtime/state.ts';

const field = <T>(context: SituationContext, name: string): T | undefined =>
  (context.event.payload as Record<string, T> | null | undefined)?.[name];

/** One of these event types happened. */
export class EventIs extends SituationSpecification {
  private readonly types: ReadonlySet<string>;

  constructor(...types: string[]) {
    super();
    this.types = new Set(types);
  }

  isSatisfiedBy({ event }: SituationContext): boolean {
    return this.types.has(event.type);
  }
}

/** The figure event is about a key of this shape. */
export class AboutFigure extends SituationSpecification {
  constructor(private readonly matches: (key: ParsedKey, raw: string) => boolean) {
    super();
  }

  isSatisfiedBy(context: SituationContext): boolean {
    // A proposal carries the whole figure; other figure events carry its key.
    const raw = field<string>(context, 'key') ?? field<{ key: string }>(context, 'figure')?.key;
    const parsed = raw === undefined ? undefined : parseKey(raw);
    return parsed !== undefined && raw !== undefined && this.matches(parsed, raw);
  }
}

/** The disputed figure is one this participant proposed. */
export class AboutMyFigure extends SituationSpecification {
  isSatisfiedBy(context: SituationContext): boolean {
    return field<string>(context, 'producerId') === context.participant.getManifest().name;
  }
}

/** A newly proposed figure that nothing else on the board disputes. */
export class ProposedUndisputed extends SituationSpecification {
  isSatisfiedBy(context: SituationContext): boolean {
    return context.event.type === 'hr.figure.proposed' && field<string>(context, 'result') === 'claimed';
  }
}

/** The user answered a question this participant asked. */
export class AnswerToMyQuestion extends SituationSpecification {
  constructor(private readonly state: HeadroomState) {
    super();
  }

  isSatisfiedBy(context: SituationContext): boolean {
    if (context.event.type !== 'hr.question.answered') return false;
    const question = this.state.questions.get(field<string>(context, 'questionId') ?? '');
    return question?.askedBy === context.participant.getManifest().name;
  }
}

/** The named reader has finished its own reading. */
export class ReaderFinished extends SituationSpecification {
  constructor(private readonly agentId: string) {
    super();
  }

  isSatisfiedBy(context: SituationContext): boolean {
    return context.event.type === 'hr.reader.done' && field<string>(context, 'agentId') === this.agentId;
  }
}

/** Everything: only the transcript, which records the run, reacts to every event. */
export class AnyEvent extends SituationSpecification {
  isSatisfiedBy(_context: SituationContext): boolean {
    return true;
  }
}
