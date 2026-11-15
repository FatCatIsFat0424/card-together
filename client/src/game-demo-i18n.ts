import { trickDemoZh, trickDemoEn } from './game-demos/trick-i18n';
import type { Locale } from './i18n';
import type { DemoText } from './game-demos/types';
import { boardsDemoZh, boardsDemoEn } from './game-demos/boards-i18n';
import { cardsDemoZh, cardsDemoEn } from './game-demos/cards-i18n';
import { bettingDemoZh, bettingDemoEn } from './game-demos/betting-i18n';
import { diceDemoZh, diceDemoEn } from './game-demos/dice-i18n';

const zh = {
  'bridge-goal': '南北對東西，四人各出一張牌為一墩。\n先叫牌定王牌與目標，再打完 13 墩。',
  'bridge-bid': ['弱牌可以要求重發，本例選擇繼續。', '選線位與花色後按確認：東家叫 3♥。\n紅心當王牌，東西至少要拿 9 墩。'],
  'bridge-contract': '其他三家都 Pass，合約確定為 3♥。',
  'bridge-follow': '北家首攻梅花，有梅花就必須跟出；\n首攻花色最大的牌贏得這一墩。',
  'bridge-lead': '贏得一墩的人，先出下一墩。',
  'bridge-trump': '東家沒有梅花，可以墊其他花色；\n西家出紅心王牌，贏下這一墩。',
  'bridge-rest': '加速打完其餘牌墩，\n牌桌會累計兩隊拿到的墩數。',
  'bridge-end': '東西拿到 9 墩，完成 3♥ 合約；\n莊家方獲勝。',
  'napoleon-goal': 'A、K、Q、J 是分數牌，全副共 16 張；\n拿破崙和小秘書合計達到目標就贏。',
  'napoleon-bid': '北家叫 9♥，其他人 Pass：\n紅心當王牌，目標是 9 張分數牌。',
  'napoleon-discard': '拿破崙拿起 2 張底牌，再選 2 張棄掉。',
  'napoleon-review': '四人局公開棄牌，其他人確認後繼續。',
  'napoleon-secretary': '北家指定 ♠A 為秘書牌：\n持有者就是小秘書，打出前身分保密。',
  'napoleon-summon': ['北家首攻王牌 2，持有大鬼的人必須打出。', '東家打出 ♠A，公開小秘書身分；\n秘書牌最大，贏下這一墩。'],
  'napoleon-rest': '加速打完其餘牌墩，\n名牌上會累計每人收下的分數牌。',
  'napoleon-end': '拿破崙與小秘書合計 13 分，超過目標 9；\n兩人一起獲勝。',
  'cp-goal': '13 張分成頭墩 3 張、中墩與尾墩各 5 張；\n四人同時排牌，不用等輪到自己。',
  'cp-front': '先選牌，再點要放入的墩：\n頭墩放一對。',
  'cp-middle': '中墩放 5 張，組成順子。',
  'cp-back': '剩下 5 張放尾墩，組成同花。\n尾墩要最大、頭墩最小，排反就是倒水。',
  'cp-submit': '確認後不能再改；\n其他人的排法要等四人都提交才公開。',
  'cp-reveal': '四人都提交後攤牌，和每位對手逐墩比較；\n一般每墩 1 分，平手 0 分。',
  'cp-bonus': '同一對手三墩全贏是打槍，這組得失分加倍。',
  'cp-end': '西家 +55 分最高，獲勝；\n四人的總分合計為 0。',
  'dice-goal': '每人 5 顆骰子，只看得到自己的；\n骰子輸光就淘汰，最後留下的人獲勝。',
  'dice-bid': '喊點是猜全場合計至少有幾顆某點數；\n北家選個數與點數，喊「4 個 2」。',
  'dice-open': ['東家不相信，選擇開骰。', '1 點百搭：兩顆 2 加兩顆 1，剛好 4 顆。\n喊點成立，開骰的東家輸一顆。'],
  'dice-next': '輸的人先喊下一輪，所有人重新搖骰。',
  'dice-raise': '加喊要增加個數，或同個數喊更大的點數；\n不相信上一個喊點就開。',
  'dice-rest': '加速進行後續輪次，\n每次開骰都有一方少一顆骰子。',
  'dice-end': '北家最後一顆骰子也輸掉；\n東家還有 3 顆，獲勝。',
} satisfies Record<string, DemoText>;

const en: Record<keyof typeof zh, DemoText> = {
  'bridge-goal': 'North–South play East–West; four cards make a trick.\nBid for trumps and a target, then play 13 tricks.',
  'bridge-bid': ['Weak hands may ask for a redeal; here both decline.', 'Pick a level and suit, then confirm: East bids 3♥.\nHearts are trumps; East–West need nine tricks.'],
  'bridge-contract': 'The other three pass: the contract is 3♥.',
  'bridge-follow': 'North leads clubs; East must follow with a club.\nThe highest card of the led suit wins the trick.',
  'bridge-lead': 'The trick winner leads the next trick.',
  'bridge-trump': 'Out of clubs, East may discard another suit;\nWest trumps with a heart and wins.',
  'bridge-rest': 'Fast-forward through the remaining tricks;\nthe table counts each team’s tricks.',
  'bridge-end': 'East–West take nine tricks and make 3♥:\ndeclarer’s side wins.',
  'napoleon-goal': 'Aces, kings, queens and jacks score: 16 in all.\nNapoleon and a secret partner must reach the bid.',
  'napoleon-bid': 'North bids 9♥ and everyone passes:\nhearts are trumps; the target is nine point cards.',
  'napoleon-discard': 'Napoleon takes the two kitty cards and discards two.',
  'napoleon-review': 'Four-player discards are shown; the others confirm.',
  'napoleon-secretary': 'North names the ♠A as the secretary card:\nits holder is a hidden partner until it is played.',
  'napoleon-summon': ['North leads trump 2: the big joker must be played.', 'East plays the ♠A and is revealed as secretary;\nthe secretary card is highest and wins.'],
  'napoleon-rest': 'Fast-forward through the remaining tricks;\nname plates count each seat’s point cards.',
  'napoleon-end': 'Napoleon and the secretary take 13, beating nine:\nthey win together.',
  'cp-goal': 'Split 13 cards: front 3, middle 5, back 5.\nEveryone arranges at once; there are no turns.',
  'cp-front': 'Select cards, then tap a row:\na pair goes in front.',
  'cp-middle': 'Five cards in the middle make a straight.',
  'cp-back': 'The last five make a flush in the back.\nBack ≥ middle ≥ front, or the hand fouls.',
  'cp-submit': 'Confirmed hands are final;\nothers stay hidden until all four submit.',
  'cp-reveal': 'Then all hands show. Each row is compared with\nevery opponent, normally for one point.',
  'cp-bonus': 'Winning all three rows against one opponent\nis a sweep and doubles that pairing.',
  'cp-end': 'West wins with +55;\nall four totals add up to zero.',
  'dice-goal': 'Everyone has five dice and sees only their own;\nlose them all and you are out. Last one left wins.',
  'dice-bid': 'A bid guesses how many dice on the whole table\nshow a face: North bids four 2s.',
  'dice-open': ['East does not believe it and calls.', 'Ones are wild: two 2s and two 1s make four.\nThe bid holds, so East loses a die.'],
  'dice-next': 'The loser opens the next round; everyone rerolls.',
  'dice-raise': 'Raise the count, or keep it and bid a higher face;\ncall if you do not believe the last bid.',
  'dice-rest': 'Fast-forward through the remaining rounds;\neach call costs one side a die.',
  'dice-end': 'North loses their last die;\nEast still has three and wins.',
};

const translationsZh = { ...zh, ...bettingDemoZh, ...boardsDemoZh, ...cardsDemoZh, ...trickDemoZh, ...diceDemoZh };
const translationsEn = { ...en, ...bettingDemoEn, ...boardsDemoEn, ...cardsDemoEn, ...trickDemoEn, ...diceDemoEn };
export type DemoTextKey = keyof typeof translationsZh;
export const gameDemoTranslations: Record<Locale, Record<DemoTextKey, DemoText>> = { 'zh-TW': translationsZh, en: translationsEn };
