import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sword, Shield, Zap, Skull, Heart, RefreshCw, Scroll, Wind, Flame, Droplets, BookOpen, ChevronRight, Lock, Unlock, Sparkles, Ghost } from 'lucide-react';

// --- GAME DATA & CONSTANTS ---

type SkillType = 'active' | 'passive' | 'trigger';
type Element = 'physical' | 'fire' | 'water' | 'lightning';

interface Skill {
  id: string;
  name: string;
  type: SkillType;
  description: string;
  rarity: number; // 1: Common, 2: Rare, 3: Epic, 4: Legendary
  cost: number; // Ki cost for actives
  cooldown?: number; // Ticks
  effect: (attacker: Entity, defender: Entity, context: BattleContext) => void;
  element?: Element;
}

interface Entity {
  maxHp: number;
  hp: number;
  maxKi: number;
  ki: number;
  atk: number;
  def: number;
  status: { [key: string]: number }; // poison: 5, burn: 3 etc. (duration)
  buffs: { [key: string]: number }; // attackUp: 5
  elementalAffinities?: Partial<Record<Element, number>>; // multiplier (1 = neutral)
}

interface BattleContext {
  log: (msg: string, type?: 'info' | 'damage' | 'heal' | 'crit') => void;
  tick: number;
  applyDamage: (amount: number, element?: Element) => number;
}

// Skill Database with Synergies
const SKILL_DB: Skill[] = [
  // --- BASICS ---
  {
    id: 'basic_cut',
    name: '中段斬り',
    type: 'active',
    rarity: 1,
    description: '基本攻撃。100%の物理ダメージを与える。',
    cost: 10,
    cooldown: 20,
    element: 'physical',
    effect: (a, d, ctx) => {
      const dmg = Math.max(1, a.atk - d.def);
      const dealt = ctx.applyDamage(dmg, 'physical');
      ctx.log(`${Math.floor(dealt)}のダメージを与えた`, 'damage');
    }
  },
  {
    id: 'heavy_blow',
    name: '上段・兜割り',
    type: 'active',
    rarity: 1,
    description: '高威力だが気力消費が激しい。180%ダメージ。',
    cost: 25,
    cooldown: 40,
    element: 'physical',
    effect: (a, d, ctx) => {
      const dmg = Math.max(1, (a.atk * 1.8) - d.def);
      const dealt = ctx.applyDamage(dmg, 'physical');
      ctx.log(`強烈な一撃！ ${Math.floor(dealt)}ダメージ`, 'damage');
    }
  },
  {
    id: 'ki_pulse',
    name: '残心・天',
    type: 'trigger',
    rarity: 1,
    description: '攻撃後、30%の確率で気力を15回復する。',
    cost: 0,
    element: 'physical',
    effect: (a, d, ctx) => {
      if (Math.random() < 0.3) {
        a.ki = Math.min(a.maxKi, a.ki + 15);
        ctx.log(`残心！気力が回復した`, 'heal');
      }
    }
  },

  // --- POISON BUILD SYNERGY ---
  {
    id: 'poison_shuriken',
    name: '毒手裏剣',
    type: 'active',
    rarity: 2,
    description: '敵を毒状態にする(100ticks)。ダメージは低い。',
    cost: 15,
    cooldown: 50,
    element: 'physical',
    effect: (a, d, ctx) => {
      ctx.applyDamage(Math.max(1, a.atk * 0.2), 'physical');
      d.status['poison'] = (d.status['poison'] || 0) + 100;
      ctx.log(`敵を毒状態にした！`, 'info');
    }
  },
  {
    id: 'toxic_executioner',
    name: '毒蛇の牙',
    type: 'passive',
    rarity: 2,
    description: '毒状態の敵に対してダメージ+50%。',
    cost: 0,
    element: 'physical',
    effect: (a, d, ctx) => {
      // Logic handled in damage calculation hook
    }
  },
  {
    id: 'venom_drain',
    name: '吸毒',
    type: 'passive',
    rarity: 3,
    description: '毒ダメージが発生するたび、自身のHPを回復する。',
    cost: 0,
    element: 'physical',
    effect: (a, d, ctx) => {}
  },

  // --- CRITICAL/LOW HP BUILD ---
  {
    id: 'desperate_strike',
    name: '窮地・修羅',
    type: 'passive',
    rarity: 2,
    description: 'HPが30%以下の時、攻撃力が2倍になる。',
    cost: 0,
    element: 'physical',
    effect: (a, d, ctx) => {}
  },
  {
    id: 'blood_sacrifice',
    name: '朱の代償',
    type: 'active',
    rarity: 3,
    description: 'HPを消費して、気力を全回復する。',
    cost: 0,
    cooldown: 100,
    element: 'physical',
    effect: (a, d, ctx) => {
      a.hp -= a.maxHp * 0.2;
      a.ki = a.maxKi;
      ctx.log(`血を代償に気力を充填！`, 'info');
    }
  },

  // --- ELEMENTAL ---
  {
    id: 'fire_sword',
    name: '火雷の剣',
    type: 'active',
    rarity: 3,
    description: '火属性2連撃。火傷を付与する。',
    cost: 20,
    cooldown: 35,
    element: 'fire',
    effect: (a, d, ctx) => {
      const dmg = Math.max(1, a.atk * 0.8);
      ctx.applyDamage(dmg, 'fire');
      ctx.applyDamage(dmg, 'fire');
      d.status['burn'] = (d.status['burn'] || 0) + 50;
      ctx.log(`炎の斬撃！ ${Math.floor(dmg * 2)}ダメージと火傷`, 'damage');
    }
  },
  {
    id: 'water_flow',
    name: '流水の構え',
    type: 'passive',
    rarity: 2,
    description: '気力回復速度が2倍になる。防御力ダウン。',
    cost: 0,
    element: 'water',
    effect: (a, d, ctx) => {}
  },

  // --- LEGENDARY ---
  {
    id: 'sword_saint',
    name: '剣聖の極意',
    type: 'passive',
    rarity: 4,
    description: '全てのスキルのクールダウンを半減させる。',
    cost: 0,
    element: 'physical',
    effect: (a, d, ctx) => {}
  },
  {
    id: 'yokai_shift',
    name: '妖怪化',
    type: 'active',
    rarity: 4,
    description: '一時的に無敵になり、攻撃力が3倍になる(100ticks)。',
    cost: 100,
    cooldown: 500,
    element: 'lightning',
    effect: (a, d, ctx) => {
      a.buffs['yokai'] = 100;
      ctx.log(`<<< 妖怪化 >>>`, 'crit');
    }
  }
];

const ENEMY_NAMES = [
  "野武士", "骸武者", "赤鬼", "大蜘蛛", "烏天狗", "雪女", "鵺", "大百足", "九尾の狐", "魔王"
];

const ELEMENTS: Element[] = ['physical', 'fire', 'water', 'lightning'];

// --- HELPERS ---

const getEnemyAffinities = (stage: number): Partial<Record<Element, number>> => {
  const base: Partial<Record<Element, number>> = { physical: 1, fire: 1, water: 1, lightning: 1 };
  const weaknesses: Element[] = ['fire', 'water', 'lightning'];
  const weakness = weaknesses[(stage - 1) % weaknesses.length];
  const resistance = weakness === 'fire' ? 'water' : weakness === 'water' ? 'lightning' : 'fire';

  base[weakness] = 1.3;
  base[resistance] = 0.7;

  return base;
};

const getElementLabel = (element: Element) => {
  switch(element) {
    case 'fire': return { label: '火', color: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-900/40', icon: <Flame size={10}/> };
    case 'water': return { label: '水', color: 'text-blue-300', bg: 'bg-blue-900/30', border: 'border-blue-900/40', icon: <Droplets size={10}/> };
    case 'lightning': return { label: '雷', color: 'text-yellow-300', bg: 'bg-yellow-900/30', border: 'border-yellow-900/40', icon: <Zap size={10}/> };
    default: return { label: '物理', color: 'text-slate-200', bg: 'bg-slate-800/50', border: 'border-slate-700', icon: <Sword size={10}/> };
  }
};

const applyElementalDamage = (
  defender: Entity,
  amount: number,
  element: Element,
  log: BattleContext['log']
) => {
  const modifier = defender.elementalAffinities?.[element] ?? 1;
  const finalDamage = Math.max(1, amount * modifier);
  defender.hp -= finalDamage;

  if (modifier > 1.05) {
    log('弱点を突いた！', 'crit');
  } else if (modifier < 0.95) {
    log('耐性によりダメージ軽減', 'info');
  }

  return finalDamage;
};

const getRarityStyles = (r: number) => {
  switch(r) {
    case 1: return { 
      border: 'border-slate-600', 
      text: 'text-slate-300', 
      bg: 'bg-slate-800',
      glow: '' 
    };
    case 2: return { 
      border: 'border-blue-500', 
      text: 'text-blue-300', 
      bg: 'bg-slate-900',
      glow: 'shadow-[0_0_10px_rgba(59,130,246,0.3)]' 
    };
    case 3: return { 
      border: 'border-purple-500', 
      text: 'text-purple-300', 
      bg: 'bg-slate-900',
      glow: 'shadow-[0_0_15px_rgba(168,85,247,0.4)]' 
    };
    case 4: return { 
      border: 'border-amber-500', 
      text: 'text-amber-300', 
      bg: 'bg-black',
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.5)] border-2' 
    };
    default: return { border: 'border-slate-600', text: 'text-white', bg: 'bg-slate-800', glow: '' };
  }
};

const SkillIcon = ({ type, className }: { type: SkillType, className?: string }) => {
  if (type === 'active') return <Sword className={className} />;
  if (type === 'passive') return <Shield className={className} />;
  return <Sparkles className={className} />;
};

// --- COMPONENTS ---

export default function RoninCodex() {
  // State
  const [souls, setSouls] = useState(100);
  const [stage, setStage] = useState(1);
  const [inventory, setInventory] = useState<Skill[]>([SKILL_DB[0]]); 
  const [equipped, setEquipped] = useState<(Skill | null)[]>([SKILL_DB[0], null, null]);
  const [battleState, setBattleState] = useState<'idle' | 'fighting' | 'won' | 'lost'>('idle');
  const [logs, setLogs] = useState<{msg: string, type: string, id: number}[]>([]);
  const [tick, setTick] = useState(0);

  // Entities Ref (Mutable for game loop performance)
  const playerRef = useRef<Entity>({ maxHp: 100, hp: 100, maxKi: 100, ki: 100, atk: 10, def: 2, status: {}, buffs: {}, elementalAffinities: { physical: 1, fire: 1, water: 1, lightning: 1 } });
  const enemyRef = useRef<Entity>({ maxHp: 100, hp: 100, maxKi: 100, ki: 100, atk: 5, def: 0, status: {}, buffs: {}, elementalAffinities: { physical: 1, fire: 1, water: 1, lightning: 1 } });
  const cooldownsRef = useRef<{[key: string]: number}>({});
  const enemySpecialRef = useRef<{ state: 'idle' | 'charging' | 'cooldown', timer: number }>({ state: 'idle', timer: 0 });
  const tickRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // --- GAME LOOP ---
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    if (battleState === 'fighting') {
      interval = setInterval(() => {
        tickRef.current += 1;
        setTick(t => t + 1);
        gameTick();
      }, 50); // Fast ticks
    }

    return () => clearInterval(interval);
  }, [battleState]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg: string, type: 'info' | 'damage' | 'heal' | 'crit' = 'info') => {
    setLogs(prev => [...prev.slice(-49), { msg, type, id: Math.random() }]);
  };

  const gameTick = () => {
    const p = playerRef.current;
    const e = enemyRef.current;
    const eq = equipped.filter(s => s !== null) as Skill[];

    // 1. Passive Checks & Stat Calculation
    let pAtk = p.atk;
    let pDef = p.def;
    let kiRegen = 1;
    let poisonBonus = 1;
    let lowHpBonus = 1;
    if (p.status['defDown']) {
      pDef = Math.max(0, pDef * 0.7);
      p.status['defDown']--;
    }

    // Apply Passives
    if (eq.some(s => s.id === 'toxic_executioner') && e.status['poison']) poisonBonus = 1.5;
    if (eq.some(s => s.id === 'desperate_strike') && p.hp <= p.maxHp * 0.3) lowHpBonus = 2.0;
    if (eq.some(s => s.id === 'water_flow')) { kiRegen = 2; pDef = 0; }
    
    // Apply Buffs
    if (p.buffs['yokai']) {
      pAtk *= 3;
      p.hp = p.maxHp; 
      p.buffs['yokai']--;
    }

    const finalAtk = pAtk * poisonBonus * lowHpBonus;

    // 2. Status Effects (DoT)
    if (e.status['poison']) {
      e.hp -= e.maxHp * 0.01;
      e.status['poison']--;
      if (eq.some(s => s.id === 'venom_drain')) {
        p.hp = Math.min(p.maxHp, p.hp + 2);
      }
    }
    if (e.status['burn']) {
      e.hp -= 5;
      e.status['burn']--;
    }

    // 3. Cooldown Reduction
    const cdReduction = eq.some(s => s.id === 'sword_saint') ? 0.5 : 1;

    // 4. Player Action (Auto-use Skills)
    eq.forEach(skill => {
      if (skill.type === 'active') {
        const currentCD = cooldownsRef.current[skill.id] || 0;

        if (currentCD <= 0) {
          if (p.ki >= skill.cost) {
            p.ki -= skill.cost;
            const ctx: BattleContext = {
              log: addLog,
              tick: 0,
              applyDamage: (amount: number, element: Element = skill.element || 'physical') => applyElementalDamage(e, amount, element, addLog)
            };

            const originalAtk = p.atk;
            p.atk = finalAtk;
            skill.effect(p, e, ctx);
            p.atk = originalAtk;

            eq.forEach(trigger => {
              if (trigger.type === 'trigger') trigger.effect(p, e, ctx);
            });

            cooldownsRef.current[skill.id] = (skill.cooldown || 10) * cdReduction;
          }
        } else {
          cooldownsRef.current[skill.id]--;
        }
      }
    });

    // 5. Enemy Action (Special pattern + basic swings)
    const currentTick = tickRef.current;
    const specialInterval = Math.max(70, 160 - stage * 6);
    const scaledInterval = Math.max(60, specialInterval - Math.floor(currentTick / 200));
    const chargeDuration = 20;
    const specialCooldown = Math.max(60, 140 - stage * 4);

    if (enemySpecialRef.current.state === 'idle') {
      enemySpecialRef.current.timer = enemySpecialRef.current.timer || scaledInterval;
      enemySpecialRef.current.timer--;
      if (enemySpecialRef.current.timer <= 0) {
        enemySpecialRef.current.state = 'charging';
        enemySpecialRef.current.timer = chargeDuration;
        addLog(`${ENEMY_NAMES[(stage-1)%10]}が妖気を練り始めた...（強攻撃予兆）`, 'crit');
      }
    } else if (enemySpecialRef.current.state === 'charging') {
      enemySpecialRef.current.timer--;
      if (enemySpecialRef.current.timer <= 0) {
        const heavyDamage = Math.max(1, (e.atk * 2.5 + stage * 1.5) - pDef);
        if (!p.buffs['yokai']) {
          const dealt = applyElementalDamage(p, heavyDamage, 'physical', addLog);
          addLog(`鬼の大振り！ ${Math.floor(dealt)}ダメージと防御低下`, 'damage');
          const debuffDuration = Math.max(60, 90 - stage * 2);
          p.status['defDown'] = Math.max(p.status['defDown'] || 0, debuffDuration);
        } else {
          addLog(`妖怪化で強攻撃を無効化！`, 'info');
        }
        enemySpecialRef.current.state = 'cooldown';
        enemySpecialRef.current.timer = specialCooldown;
        addLog(`鬼が体勢を立て直している（クールダウン）`, 'info');
      }
    } else if (enemySpecialRef.current.state === 'cooldown') {
      enemySpecialRef.current.timer--;
      if (enemySpecialRef.current.timer <= 0) {
        enemySpecialRef.current.state = 'idle';
        enemySpecialRef.current.timer = scaledInterval;
        addLog(`鬼が再び構えを整えた`, 'info');
      }
    }

    if (Math.random() < 0.05) {
      const dmg = Math.max(1, e.atk - pDef);
      if (!p.buffs['yokai']) {
        const dealt = applyElementalDamage(p, dmg, 'physical', addLog);
        addLog(`${ENEMY_NAMES[(stage-1)%10]}の攻撃！ ${Math.floor(dealt)}ダメージ`, 'damage');
      } else {
        addLog(`妖怪化により攻撃を無効化！`, 'info');
      }
    }

    // 6. Regen
    p.ki = Math.min(p.maxKi, p.ki + kiRegen);

    // 7. Win/Loss Check
    if (e.hp <= 0) {
      setBattleState('won');
      const soulGain = stage * 10 + Math.floor(Math.random() * 20);
      setSouls(s => s + soulGain);
      addLog(`第${stage}階層を制覇！ ${soulGain}の魂を獲得した。`, 'crit');
    } else if (p.hp <= 0) {
      setBattleState('lost');
      addLog(`敗北した...`, 'damage');
    }
  };

  const startBattle = (targetStage: number = stage) => {
    const hpScale = 1 + (targetStage * 0.2);
    const atkScale = 1 + (targetStage * 0.15);
    
    playerRef.current = {
      maxHp: 200 + (targetStage * 10),
      hp: 200 + (targetStage * 10),
      maxKi: 100 + (targetStage * 2),
      ki: 100 + (targetStage * 2),
      atk: 10 + (targetStage * 2),
      def: 2 + Math.floor(targetStage * 0.5),
      status: {},
      buffs: {},
      elementalAffinities: { physical: 1, fire: 1, water: 1, lightning: 1 }
    };

    enemyRef.current = {
      maxHp: Math.floor(150 * hpScale),
      hp: Math.floor(150 * hpScale),
      maxKi: 100,
      ki: 100,
      atk: Math.floor(8 * atkScale),
      def: Math.floor(targetStage * 1),
      status: {},
      buffs: {},
      elementalAffinities: getEnemyAffinities(targetStage)
    };

    enemySpecialRef.current = { state: 'idle', timer: Math.max(70, 160 - targetStage * 6) };

    cooldownsRef.current = {};
    setLogs([]);
    addLog(`第${targetStage}階層 - ${ENEMY_NAMES[(targetStage-1)%10]} との死合開始`, 'info');
    setBattleState('fighting');
  };

  const handleBattleButton = () => {
    if (battleState === 'won') {
      setStage(prev => {
        const nextStage = prev + 1;
        startBattle(nextStage);
        return nextStage;
      });
    } else {
      startBattle();
    }
  };

  const meditate = () => {
    if (souls < 50) return;
    setSouls(s => s - 50);
    const roll = Math.random();
    let rarity = 1;
    if (roll > 0.95) rarity = 4;
    else if (roll > 0.8) rarity = 3;
    else if (roll > 0.6) rarity = 2;

    const pool = SKILL_DB.filter(s => s.rarity === rarity);
    const newSkill = pool[Math.floor(Math.random() * pool.length)];
    
    setInventory(prev => [...prev, newSkill]);
    addLog(`冥想の末、「${newSkill.name}」を会得した。`, 'heal');
  };

  const equipSkill = (skill: Skill, index: number) => {
    const newEq = [...equipped];
    const existingIdx = newEq.findIndex(s => s && s.id === skill.id);
    if (existingIdx !== -1) newEq[existingIdx] = null;
    
    newEq[index] = skill;
    setEquipped(newEq);
  };

  const unequipSkill = (index: number) => {
    const newEq = [...equipped];
    newEq[index] = null;
    setEquipped(newEq);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-red-900 selection:text-white flex flex-col items-center p-4 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-900/10 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-red-900/10 rounded-full blur-[100px]"></div>
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] opacity-30"></div>
      </div>

      <header className="w-full max-w-6xl flex justify-between items-center border-b border-white/10 pb-4 mb-6 relative z-10">
        <div>
          <h1 className="text-4xl font-serif font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-amber-600 flex items-center gap-3 drop-shadow-sm">
            <Ghost className="w-8 h-8 text-red-500" />
            RONIN CODEX
          </h1>
          <p className="text-xs text-slate-500 tracking-[0.5em] font-serif uppercase mt-1 ml-1">The Build Simulator</p>
        </div>
        <div className="flex gap-8 text-sm font-serif">
          <div className="flex flex-col items-end">
            <span className="text-amber-500 text-xs tracking-widest uppercase mb-1 flex items-center gap-1"><Zap size={12}/> Amrita (Souls)</span>
            <span className="text-2xl font-bold text-white drop-shadow-md">{souls}</span>
          </div>
          <div className="flex flex-col items-end">
             <span className="text-red-500 text-xs tracking-widest uppercase mb-1 flex items-center gap-1"><ChevronRight size={12}/> Floor</span>
            <span className="text-2xl font-bold text-white drop-shadow-md">{stage}</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 h-[80vh] relative z-10">
        
        {/* LEFT COLUMN: BUILD (Width: 3/12) */}
        <div className="lg:col-span-3 flex flex-col gap-4 bg-black/40 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-xl overflow-hidden">
          <h2 className="text-sm font-serif font-bold border-b border-white/10 pb-3 mb-2 flex items-center gap-2 text-slate-300 uppercase tracking-widest">
            <Scroll size={16} className="text-amber-600"/> Equipped Skills
          </h2>
          
          <div className="space-y-4">
            {equipped.map((skill, idx) => {
              const style = skill ? getRarityStyles(skill.rarity) : { border: 'border-slate-800', text: '', bg: '', glow: '' };
              return (
                <div key={idx} className="relative group">
                  <div className="absolute -left-2 top-1/2 -translate-y-1/2 text-xs font-serif text-slate-600 w-4">{idx + 1}</div>
                  <div 
                    className={`h-24 border ${style.border} ${style.bg} ${style.glow} rounded-sm flex flex-col items-center justify-center cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden`}
                    onClick={() => skill && unequipSkill(idx)}
                  >
                    {skill ? (
                      <div className="w-full h-full p-3 flex flex-col relative z-10">
                         {/* Background Icon Watermark */}
                        <div className="absolute right-[-10px] bottom-[-10px] opacity-10 rotate-12">
                          <SkillIcon type={skill.type} className={`w-20 h-20 ${style.text}`} />
                        </div>

                        <div className={`font-serif font-bold text-sm ${style.text} flex justify-between items-start leading-tight`}>
                          {skill.name}
                        </div>
                        <div className="flex gap-2 mt-1">
                           <span className={`text-[10px] uppercase tracking-wider px-1 rounded border border-white/10 ${style.text} bg-black/30`}>
                             {skill.type}
                           </span>
                           {skill.cost > 0 && <span className="text-[10px] text-blue-400">KI: {skill.cost}</span>}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-auto line-clamp-2 leading-relaxed opacity-80">{skill.description}</div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 opacity-30">
                        <div className="w-8 h-8 border border-slate-600 rounded-full flex items-center justify-center">
                          <Lock size={12} />
                        </div>
                        <span className="text-slate-500 text-[10px] uppercase tracking-widest">Empty Slot</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {equipped.length < 5 && (
               <button 
                onClick={() => setEquipped(p => [...p, null])}
                disabled={souls < 500}
                className="w-full py-3 text-xs text-slate-500 border border-slate-800 border-dashed rounded hover:text-slate-300 disabled:opacity-30 hover:bg-white/5 transition-colors uppercase tracking-widest"
              >
                + Unlock Slot (500)
              </button>
            )}
          </div>

          <div className="mt-auto pt-4 border-t border-white/10 flex flex-col gap-3">
             <div className="flex justify-between items-center">
               <h3 className="font-serif text-xs text-slate-500 uppercase tracking-widest">Grimoire</h3>
               <button 
                 onClick={meditate}
                 className="px-4 py-1.5 bg-amber-900/20 text-amber-500 border border-amber-900/50 rounded-sm text-xs hover:bg-amber-900/40 transition-all font-serif flex items-center gap-2"
               >
                 <Sparkles size={12}/> Meditate (50)
               </button>
             </div>
             <div className="h-40 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
               {inventory.map((skill, idx) => {
                 const style = getRarityStyles(skill.rarity);
                 return (
                   <div 
                     key={idx}
                     className={`p-2 bg-black/40 border-l-2 ${style.border} rounded-r-sm hover:bg-white/5 cursor-pointer flex justify-between items-center group transition-colors`}
                   >
                     <div className="flex items-center gap-2 overflow-hidden">
                       <SkillIcon type={skill.type} className={`w-3 h-3 ${style.text} shrink-0`} />
                       <span className={`text-xs font-serif truncate ${style.text}`}>{skill.name}</span>
                     </div>
                     <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                       {equipped.map((_, slotIdx) => (
                         <button 
                           key={slotIdx}
                           onClick={() => equipSkill(skill, slotIdx)}
                           className="w-5 h-5 bg-slate-800 rounded-sm text-[10px] hover:bg-slate-600 text-slate-300 border border-slate-700"
                         >
                           {slotIdx + 1}
                         </button>
                       ))}
                     </div>
                   </div>
                 );
               })}
             </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: COMBAT LOG (Width: 6/12) */}
        <div className="lg:col-span-6 flex flex-col bg-black/80 backdrop-blur border border-white/10 rounded-xl overflow-hidden shadow-2xl relative">
          
          {/* Header/Banner Area */}
          <div className="h-12 bg-gradient-to-b from-slate-900 to-black border-b border-white/5 flex items-center justify-center">
             <span className="text-slate-600 text-[10px] tracking-[0.3em] uppercase font-serif">Battle Chronicles</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 py-4 px-6 font-mono text-sm custom-scrollbar bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900/50 to-black">
             {logs.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 gap-4">
                 <Sword size={48} strokeWidth={1} />
                 <p className="font-serif tracking-widest text-sm">AWAITING BATTLE</p>
               </div>
             )}
             {logs.map((log) => (
               <div key={log.id} className={`
                 flex gap-3 items-start animate-fade-in
                 ${log.type === 'damage' ? 'text-red-400' : ''}
                 ${log.type === 'heal' ? 'text-emerald-400' : ''}
                 ${log.type === 'crit' ? 'text-amber-400 text-base py-1 border-y border-amber-900/30 bg-amber-900/10' : ''}
                 ${log.type === 'info' ? 'text-slate-500' : ''}
               `}>
                 <span className="text-[10px] opacity-30 w-8 shrink-0 pt-1">{log.type.toUpperCase().slice(0,3)}</span>
                 <span className={log.type === 'crit' ? 'font-serif font-bold tracking-wider' : ''}>{log.msg}</span>
               </div>
             ))}
             <div ref={logEndRef} />
          </div>

          <div className="p-4 bg-slate-950/50 border-t border-white/5 backdrop-blur-sm">
            {battleState === 'fighting' ? (
              <button 
                onClick={() => setBattleState('lost')} 
                className="w-full py-4 bg-red-950/30 border border-red-900/50 text-red-500 hover:text-red-400 hover:bg-red-900/50 transition-all font-serif tracking-[0.2em] text-sm uppercase"
              >
                Surrender
              </button>
            ) : (
              <button
                onClick={handleBattleButton}
                className={`w-full py-4 font-serif font-bold tracking-[0.3em] text-lg transition-all relative overflow-hidden group
                  ${battleState === 'won' ? 'text-amber-100 bg-amber-900/20 border border-amber-600/50 hover:bg-amber-900/40' :
                    battleState === 'lost' ? 'text-slate-400 bg-slate-900 border border-slate-700 hover:bg-slate-800' :
                    'text-red-100 bg-red-950 border border-red-800 hover:bg-red-900 hover:border-red-600'}`}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:animate-shine"></div>
                <span className="relative z-10">
                   {battleState === 'won' ? 'NEXT FLOOR' : battleState === 'lost' ? 'RETRY' : 'ENGAGE'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: STATUS (Width: 3/12) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
           {/* Player Status */}
           <div className="bg-black/40 backdrop-blur-md p-5 rounded-xl border border-white/10 shadow-lg">
             <h3 className="text-slate-500 text-[10px] font-serif font-bold mb-4 uppercase tracking-[0.2em] border-b border-white/5 pb-2">Ronin Status</h3>
             {battleState === 'fighting' ? (
               <div className="space-y-4">
                 <div>
                   <div className="flex justify-between text-xs mb-1 font-mono text-slate-300">
                      <span className="text-red-400 font-bold">HP</span>
                      <span>{Math.floor(playerRef.current.hp)}</span>
                   </div>
                   <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                     <div className="bg-gradient-to-r from-red-900 to-red-600 h-full transition-all duration-200" style={{width: `${Math.max(0, (playerRef.current.hp / playerRef.current.maxHp) * 100)}%`}}></div>
                   </div>
                 </div>
                 <div>
                   <div className="flex justify-between text-xs mb-1 font-mono text-slate-300">
                      <span className="text-blue-400 font-bold">KI</span>
                      <span>{Math.floor(playerRef.current.ki)}</span>
                   </div>
                   <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                     <div className="bg-gradient-to-r from-blue-900 to-blue-500 h-full transition-all duration-200" style={{width: `${Math.max(0, (playerRef.current.ki / playerRef.current.maxKi) * 100)}%`}}></div>
                   </div>
                 </div>
               </div>
             ) : (
                <div className="text-center py-6 text-slate-600 text-xs font-serif italic">Meditation State</div>
             )}
           </div>

           {/* Enemy Status */}
           <div className="bg-black/40 backdrop-blur-md p-5 rounded-xl border border-red-900/30 flex-1 relative overflow-hidden shadow-lg flex flex-col items-center">
             {battleState === 'fighting' && (
               <>
                <div className="w-full flex justify-between items-center mb-6 border-b border-red-900/20 pb-2">
                  <span className="text-red-500 text-[10px] font-serif font-bold tracking-[0.2em]">THREAT DETECTED</span>
                  <Skull size={14} className="text-red-600 animate-pulse"/>
                </div>
                
                <div className="relative mb-6">
                   <div className={`w-40 h-40 rounded-full border border-red-900/50 flex items-center justify-center bg-black shadow-[0_0_30px_rgba(153,27,27,0.2)] transition-transform duration-75 ${tick % 4 === 0 ? 'scale-[1.02]' : 'scale-100'}`}>
                      <div className="absolute inset-0 rounded-full border border-white/5 animate-[spin_10s_linear_infinite]"></div>
                      <span className="text-5xl text-red-700 font-serif z-10 opacity-80 drop-shadow-lg">鬼</span>
                   </div>
                   {/* Enemy HP Bar Floating below */}
                   <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-32">
                      <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden border border-red-900/50">
                        <div className="bg-red-600 h-full transition-all duration-200" style={{width: `${Math.max(0, (enemyRef.current.hp / enemyRef.current.maxHp) * 100)}%`}}></div>
                      </div>
                   </div>
                </div>

                <div className="text-center mb-4">
                  <h2 className="text-xl font-serif text-slate-200">{ENEMY_NAMES[(stage-1)%10]}</h2>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Floor {stage} Boss</p>
                  <div className="flex flex-wrap gap-2 justify-center mt-3">
                    {(enemyRef.current.elementalAffinities ? ELEMENTS.filter(el => (enemyRef.current.elementalAffinities?.[el] ?? 1) > 1.05) : []).map(el => {
                      const info = getElementLabel(el);
                      return (
                        <div key={`weak-${el}`} className={`flex items-center gap-1 px-2 py-1 rounded border ${info.border} ${info.bg} ${info.color} text-[10px] font-semibold uppercase`}>
                          {info.icon}
                          <span>Weak</span>
                          <span>{info.label}</span>
                        </div>
                      );
                    })}
                    {(enemyRef.current.elementalAffinities ? ELEMENTS.filter(el => (enemyRef.current.elementalAffinities?.[el] ?? 1) < 0.95) : []).map(el => {
                      const info = getElementLabel(el);
                      return (
                        <div key={`resist-${el}`} className={`flex items-center gap-1 px-2 py-1 rounded border ${info.border} ${info.bg} ${info.color} text-[10px] font-semibold uppercase opacity-70`}>
                          {info.icon}
                          <span>Resist</span>
                          <span>{info.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                 <div className="flex gap-2 justify-center text-xs mt-auto w-full">
                    {enemyRef.current.status['poison'] > 0 && (
                      <div className="flex items-center gap-1 text-purple-400 bg-purple-950/30 px-2 py-1 rounded border border-purple-900/50">
                        <Droplets size={10}/> <span className="text-[10px]">POISON</span>
                      </div>
                    )}
                    {enemyRef.current.status['burn'] > 0 && (
                      <div className="flex items-center gap-1 text-orange-400 bg-orange-950/30 px-2 py-1 rounded border border-orange-900/50">
                        <Flame size={10}/> <span className="text-[10px]">BURN</span>
                      </div>
                    )}
                 </div>
               </>
             )}
             
             {battleState === 'won' && (
               <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm animate-fade-in z-20">
                 <h2 className="text-4xl font-serif text-amber-500 mb-2 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]">VANQUISHED</h2>
                 <div className="h-px w-20 bg-amber-800 mb-4"></div>
                 <p className="text-xs text-slate-400 tracking-[0.3em]">SOULS RETRIEVED</p>
               </div>
             )}
             {battleState === 'lost' && (
               <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90 backdrop-blur-sm animate-fade-in z-20">
                 <h2 className="text-4xl font-serif text-red-600 mb-2 drop-shadow-[0_0_15px_rgba(220,38,38,0.6)]">DEATH</h2>
                 <p className="text-xs text-red-900/50 tracking-[0.5em] font-bold">FREED FROM THE COIL</p>
               </div>
             )}
           </div>
        </div>

      </main>

      <style>{`
        @keyframes shine {
          100% { transform: translateX(100%); }
        }
        .animate-shine {
          animation: shine 1s;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.3); 
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155; 
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569; 
        }
      `}</style>
    </div>
  );
}
