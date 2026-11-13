import { MatchViewerSession } from '../../src/game/viewer/session'

/**
 * Find an actual live, swept, hand-held catch rather than depending on one
 * fixed seed still producing the same shot after a PHYSICAL engine change.
 * The returned session keeps all real events and physical match state.
 * No ball, possession, catch, or command is fabricated.
 */
export function matchWithLiveGoalkeeperCatch(): MatchViewerSession {
  const candidates=[
    123456789,7654321,42,90,117,205,832,4100,9999,
    123,321,1111,2222,3333,55555,12345,
  ]
  for(const seed of candidates) {
    const session=new MatchViewerSession(seed)
    for(let i=0;i<1400 &&
      !session.state.ball.outsidePitch &&
      !session.state.goalEvents.length &&
      !session.state.automaticContactEvents.some(e=>e.outcome==='caught');
      i++) {
      session.advance(1)
    }
    if(session.state.automaticContactEvents.some(e=>e.outcome==='caught'))
      return session
  }
  throw new Error('Live goalkeeper catch sample exhausted; investigate real shot/keeper behaviour')
}
