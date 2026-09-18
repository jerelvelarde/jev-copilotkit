import { setTimeout as delay } from "node:timers/promises";
import {
  articleUrl,
  DEFAULT_LANES,
  normalizeTitle,
  type Article,
  type RaceConfig,
  type RaceDependencies,
} from "./types";

// Deliberately authored illustrations, not recorded Jev/LLM runs or a verified
// Wikipedia graph. The UI labels this mode and its timings as sample data.
const scenarios = [
  {
    start: "Baseball",
    target: "Sun",
    paths: [
      ["Baseball", "United States", "Earth", "Sun"],
      ["Baseball", "Sport", "Human", "Earth", "Sun"],
      ["Baseball", "Bat-and-ball games", "Cricket", "Weather", "Sun"],
      ["Baseball", "United States", "Geography", "Earth", "Sun"],
    ],
  },
  {
    start: "Coffee",
    target: "Napoleon",
    paths: [
      ["Coffee", "Saint-Domingue", "Napoleon"],
      ["Coffee", "France", "French Revolution", "Napoleon"],
      [
        "Coffee",
        "Ottoman Empire",
        "Egypt",
        "French campaign in Egypt and Syria",
        "Napoleon",
      ],
      ["Coffee", "History of coffee", "France", "Napoleon"],
    ],
  },
  {
    start: "Rubber duck",
    target: "Moon",
    paths: [
      ["Rubber duck", "Rubber", "Apollo program", "Moon"],
      ["Rubber duck", "Toy", "Space exploration", "Moon"],
      ["Rubber duck", "Plastic", "Technology", "NASA", "Moon"],
      ["Rubber duck", "Toy", "Rocket", "Apollo program", "Moon"],
    ],
  },
  {
    start: "Jazz",
    target: "Antarctica",
    paths: [
      ["Jazz", "Norway", "Antarctica"],
      ["Jazz", "New Orleans", "United States", "Antarctica"],
      ["Jazz", "Music", "Culture", "Geography", "Antarctica"],
      ["Jazz", "Norway", "Roald Amundsen", "Antarctica"],
    ],
  },
];
const intros: Record<string, string> = {
  Baseball:
    "Baseball is a bat-and-ball sport played between two teams of nine players. The teams take turns batting and fielding, scoring runs by advancing around four bases. The sport has a long history in the United States and is played around the world.",
  "United States":
    "The United States of America is a country primarily located in North America. Its varied geography spans mountains, plains, deserts, and coastlines. Baseball has long been part of its sporting culture.",
  Earth:
    "Earth is the third planet from the Sun and the only astronomical object known to harbor life. Its surface is shaped by oceans and continents, while its atmosphere supports a wide range of climates and ecosystems.",
  Sun: "The Sun is the star at the center of the Solar System. It is a nearly perfect sphere of hot plasma, heated by nuclear fusion reactions in its core. Its energy is the most important source of light and heat for life on Earth.",
  Sport:
    "Sport includes physical activities and games that involve skill, competition, and rules. Individual athletes and teams compete in activities ranging from running and swimming to baseball and cricket.",
  Human:
    "Humans are primates characterized by complex language, social organization, and the use of tools. They inhabit environments across Earth and develop diverse cultures, games, and traditions.",
  "Bat-and-ball games":
    "Bat-and-ball games are field games played by opposing teams. A player strikes a ball with a bat, while the other team attempts to retrieve it. Baseball and cricket are two widely played examples.",
  Cricket:
    "Cricket is a bat-and-ball game played between two teams of eleven players. Matches take place on a field with a central pitch and may be influenced by weather and the condition of the playing surface.",
  Weather:
    "Weather describes the state of the atmosphere, including temperature, wind, clouds, and precipitation. Uneven heating of Earth's surface by the Sun helps drive atmospheric movement.",
  Geography:
    "Geography studies places, environments, and the relationships between people and their surroundings. Physical geography examines Earth's landforms, atmosphere, and natural processes.",
  Coffee:
    "Coffee is a beverage prepared from roasted coffee beans. Its story connects botany, trade, culture, and the history of empires.",
  "Saint-Domingue":
    "Saint-Domingue was a French colony on the Caribbean island of Hispaniola. Its history connects the coffee trade, the Haitian Revolution, and Napoleonic France.",
  Napoleon:
    "Napoleon Bonaparte was a French military and political leader. He rose to prominence during the French Revolution and became Emperor of the French.",
  "Rubber duck":
    "A rubber duck is a toy shaped like a duck, often made from flexible plastic. It appears in bathing, popular culture, and programming folklore.",
  Moon: "The Moon is Earth's natural satellite. Human exploration of its surface began with the Apollo program.",
  Jazz: "Jazz is a music genre with roots in the African-American communities of New Orleans. Its styles and traditions have spread around the world.",
  Antarctica:
    "Antarctica is Earth's southernmost continent. It is home to the South Pole, vast ice sheets, and international scientific research stations.",
};

export function createSampleDependencies(config: RaceConfig): RaceDependencies {
  const scenario = scenarios.find(
    (s) =>
      normalizeTitle(s.start) === normalizeTitle(config.start) &&
      normalizeTitle(s.target) === normalizeTitle(config.target),
  );
  if (!scenario)
    throw new Error(
      "Sample mode supports the preset challenges. Switch to Live for other articles.",
    );
  const graph = new Map<string, Article>();
  for (const path of scenario.paths)
    for (const [i, title] of path.entries()) {
      if (!graph.has(title))
        graph.set(title, {
          id: graph.size + 1,
          title,
          url: articleUrl(title),
          extract:
            intros[title] ||
            `${title} is the next article in this illustrative route. This sample preview demonstrates the race interface; switch to Live to fetch Wikipedia's current introduction and links.`,
          links: [],
        });
      const article = graph.get(title)!;
      if (path[i + 1] && !article.links.includes(path[i + 1]))
        article.links.push(path[i + 1]);
    }
  return {
    loadPage: async (title, signal) => {
      await delay(170, undefined, { signal });
      const found = [...graph.values()].find(
        (p) => normalizeTitle(p.title) === normalizeTitle(title),
      );
      if (!found) throw new Error("Article is not in the sample graph.");
      return found;
    },
    providers: Object.fromEntries(
      DEFAULT_LANES.map((lane, index) => [
        lane.id,
        async (context, signal) => {
          const waitMs = [620, 1050, 1350, 1550][index];
          await delay(waitMs, undefined, { signal });
          const path = scenario.paths[index];
          const next = path[path.indexOf(context.page.title) + 1];
          if (!next || !context.candidates.includes(next))
            throw new Error(
              "Sample path is inconsistent with the sample graph.",
            );
          return {
            title: next,
            confidence: null,
            choices: [],
            modelMs: waitMs,
            inputTokens: null,
            modelCalls: 0,
            method: "sample" as const,
          };
        },
      ]),
    ),
  };
}
