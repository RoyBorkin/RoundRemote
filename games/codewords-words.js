// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Code Words word lists — our own, mostly concrete single words, in categories (pick some or play them all), plus an
// easy Kids set. English ~410 + ~150 kids, Hebrew ~410 + ~160 kids. Hebrew words are single words without niqqud.
export const CATS = [
  { id: 'animals', en: 'Animals', he: 'חיות', icon: '🦒' }, { id: 'food', en: 'Food', he: 'אוכל', icon: '🍕' },
  { id: 'home', en: 'Home', he: 'בית', icon: '🛋️' }, { id: 'nature', en: 'Nature', he: 'טבע', icon: '🌋' },
  { id: 'city', en: 'City', he: 'עיר', icon: '🏙️' }, { id: 'travel', en: 'On the move', he: 'תחבורה', icon: '🚲' },
  { id: 'sports', en: 'Sports & games', he: 'ספורט ומשחקים', icon: '⚽' }, { id: 'arts', en: 'Music & art', he: 'מוזיקה ואמנות', icon: '🎸' },
  { id: 'tools', en: 'Tools & stuff', he: 'כלים וחפצים', icon: '🔨' }, { id: 'clothes', en: 'Clothes', he: 'בגדים', icon: '🧣' },
  { id: 'science', en: 'Space & science', he: 'חלל ומדע', icon: '🔭' }, { id: 'sea', en: 'Sea', he: 'ים', icon: '⚓' },
  { id: 'people', en: 'People', he: 'אנשים', icon: '🧑‍🍳' }, { id: 'fantasy', en: 'Fantasy', he: 'דמיון', icon: '🧙' },
  { id: 'school', en: 'School & office', he: 'בית ספר ומשרד', icon: '✏️' }, { id: 'tech', en: 'Tech', he: 'טכנולוגיה', icon: '💻' },
];

const EN = {
  animals: 'giraffe zebra camel donkey goat sheep rooster parrot owl flamingo peacock pigeon swan crocodile turtle frog snail butterfly beetle ant bee hedgehog squirrel raccoon koala panda gorilla tiger cheetah wolf fox deer hippo rhino elephant llama hamster lizard',
  food: 'pizza pasta burger sandwich salad soup bread butter cheese pancake waffle cookie cake donut popcorn pretzel noodle sushi taco omelet yogurt cereal banana pineapple watermelon strawberry cherry grape mango avocado tomato potato onion garlic cucumber mushroom pickle peanut cinnamon',
  home: 'sofa pillow blanket lamp mirror curtain carpet ladder bucket broom sponge towel bathtub shower fridge oven kettle toaster blender spoon cup bowl candle doorbell mailbox fireplace drawer closet staircase attic garage balcony',
  nature: 'mountain volcano desert jungle island waterfall river lake cave canyon glacier valley rainbow thunder lightning tornado snowflake leaf acorn pinecone cactus sunflower tulip puddle pebble boulder sunset meadow swamp geyser',
  city: 'street sidewalk traffic tunnel castle museum library bakery pharmacy supermarket playground fountain statue lighthouse elevator escalator parking subway airport cinema prison zoo circus market bench billboard cafe',
  travel: 'bicycle scooter skateboard motorcycle tractor bulldozer taxi bus truck submarine sailboat canoe rocket airplane balloon suitcase passport ticket map compass backpack tent camper',
  sports: 'soccer tennis golf bowling boxing karate surfing skiing hockey basketball volleyball baseball marathon trophy medal whistle referee goalkeeper puzzle chess dominoes kite yoyo frisbee trampoline',
  arts: 'guitar violin drum trumpet harp accordion saxophone microphone headphones radio paintbrush crayon easel sculpture ballet tango disco orchestra choir melody karaoke camera photo puppet',
  tools: 'hammer screwdriver wrench shovel rake saw scissors glue tape magnet rope chain padlock flashlight umbrella wallet coin envelope stamp helmet goggles bubble toolbox',
  clothes: 'hat scarf mitten sandal sneaker slipper jacket sweater hoodie pajamas apron uniform costume bikini necklace bracelet earring tiara zipper pocket necktie wig sunglasses',
  science: 'planet comet asteroid galaxy astronaut meteor orbit eclipse atom molecule laboratory fossil skeleton crystal gravity oxygen magnifier volcano rocket spaceship thermometer beaker',
  sea: 'ocean anchor sail shell coral jellyfish starfish seahorse lobster crab oyster pearl treasure captain mermaid surfboard snorkel buoy harbor iceberg dolphin lighthouse island seagull lifeguard',
  people: 'chef baker farmer firefighter clown magician dentist plumber carpenter mechanic sailor cowboy detective waiter barber tailor painter prince judge coach grandma baby twins astronaut referee grandpa toddler',
  fantasy: 'wizard fairy troll elf goblin vampire zombie mummy werewolf genie potion wand monster griffin cyclops pegasus castle treasure mermaid  ogre sphinx elixir',
  school: 'pencil eraser notebook desk chalk blackboard calculator stapler paperclip folder printer homework exam diploma globe dictionary poster sticker briefcase laptop backpack  locker timetable',
  tech: 'computer keyboard phone charger cable drone antenna speaker television remote password website email emoji selfie video joystick app headphones camera  router webcam podcast',
};
const KIDS_EN = 'cat dog cow pig duck horse fish bird bear lion monkey rabbit frog sun moon star tree flower rain snow cloud apple banana cake cookie pizza milk egg candy ball doll kite bike car bus train boat plane house bed chair door window book pencil crayon hat shoe coat cup spoon clock lamp box toy teddy robot rocket dinosaur dragon princess castle tent beach sand shell bubble balloon rainbow owl bee ant snail butterfly turtle elephant giraffe zebra tiger panda sheep goat hen egg bread cheese grape strawberry watermelon icecream juice soup teeth hand foot nose ear hair smile hug baby grandma farmer chef clown bell drum guitar song dance party gift candle bath towel soap brush comb mirror garden flowerpot swing slide sandbox puddle umbrella mitten scarf pear peach cupcake muffin blocks puzzle wagon tractor firetruck scooter sled snowball sandcastle seesaw puppy kitten pony ladybug caterpillar jellyfish';

const HE = {
  animals: 'ג׳ירפה זברה גמל חמור עז כבשה תרנגול תוכי ינשוף פלמינגו טווס יונה ברבור תנין צב צפרדע חילזון פרפר חיפושית נמלה דבורה קיפוד סנאי קואלה פנדה גורילה נמר צ׳יטה זאב שועל צבי היפופוטם קרנף פיל לאמה אוגר לטאה',
  food: 'פיצה פסטה המבורגר כריך סלט מרק לחם חמאה גבינה פנקייק וופל עוגייה עוגה סופגנייה פופקורן בייגלה שקשוקה פלאפל חומוס שווארמה פיתה סושי טאקו חביתה יוגורט דגנים בננה אננס אבטיח תות דובדבן ענב מנגו אבוקדו עגבנייה בצל שום מלפפון פטרייה בוטן קינמון',
  home: 'ספה כרית שמיכה מנורה מראה וילון שטיח סולם דלי מטאטא ספוג מגבת אמבטיה מקלחת מקרר תנור קומקום טוסטר בלנדר כפית כוס קערה נר פעמון מגירה ארון מדרגות מוסך מרפסת עציץ',
  nature: 'הר מדבר ג׳ונגל אי מפל נהר אגם מערה קניון קרחון עמק צוק חוף קשת רעם ברק טורנדו עלה בלוט אצטרובל קקטוס חמנייה צבעוני שלולית סלע שקיעה',
  city: 'רחוב מדרכה רמזור מנהרה טירה מוזיאון ספרייה מאפייה סופרמרקט מזרקה פסל מגדלור מעלית דרגנוע חניה אצטדיון קולנוע כלא קרקס שוק בנק גשר',
  travel: 'אופניים קורקינט סקייטבורד אופנוע טרקטור דחפור אמבולנס מונית אוטובוס משאית צוללת מפרשית קאנו טיל מסוק מטוס מצנח מזוודה דרכון כרטיס מפה מצפן תרמיל אוהל',
  sports: 'כדורגל טניס גולף באולינג איגרוף קראטה גלישה סקי הוקי כדורסל כדורעף בייסבול מרתון גביע מדליה משרוקית שופט שוער פאזל שחמט דומינו עפיפון יויו פריזבי טרמפולינה',
  arts: 'גיטרה כינור תוף חצוצרה נבל אקורדיון סקסופון מיקרופון אוזניות רדיו תקליט מכחול בלט טנגו דיסקו תזמורת מקהלה הופעה מנגינה קריוקי מצלמה תמונה בובה',
  tools: 'פטיש מברג מפתח מגרפה מסור מקדחה מספריים דבק סלוטייפ מגנט חבל שרשרת מנעול פנס מטרייה ארנק מטבע מעטפה בול סוללה קסדה משקפת בועה בלון',
  clothes: 'כובע צעיף כפפה גרב סנדל נעל מגף מעיל סוודר קפוצ׳ון פיג׳מה סינר מדים תחפושת ביקיני צמיד עגיל כתר נזר רוכסן כיס כפתור עניבה חגורה פאה',
  science: 'פלנטה שביט אסטרואיד גלקסיה אסטרונאוט מטאוריט מסלול ליקוי חייזר רובוט אטום מולקולה מיקרוסקופ מעבדה מאובן שלד גביש כבידה חמצן טלסקופ דינוזאור חללית',
  sea: 'אוקיינוס גל עוגן מפרש צדף אלמוג מדוזה לובסטר סרטן פנינה אוצר פיראט קפטן גלשן שנורקל מצוף נמל כריש לווייתן דולפין סירה',
  people: 'שף אופה חקלאי כבאי שוטר ליצן קוסם אינסטלטור נגר מכונאי טייס מלח חייל קאובוי בלש מלצר ספר חייט צייר מלך מלכה נסיך מאמן סבתא תינוק תאומים',
  fantasy: 'דרקון מכשף פיה ענק טרול גמד שדון ערפד זומבי מומיה ג׳יני מכשפה רוח שיקוי שרביט כישוף מפלצת נינג׳ה אביר נסיכה קיקלופ פגסוס',
  school: 'עיפרון מחק מחברת שולחן גיר לוח סרגל מחשבון שדכן מהדק תיקייה מדפסת שיעורים מבחן תעודה גלובוס מילון פוסטר מדבקה תיק לפטופ',
  tech: 'מחשב מקלדת עכבר טלפון טאבלט מטען כבל רחפן לוויין אנטנה רמקול טלוויזיה שלט סיסמה אתר מייל אימוג׳י סלפי סרטון ג׳ויסטיק אפליקציה',
};
const KIDS_HE = 'חתול כלב פרה חזיר ברווז סוס דג ציפור דוב אריה קוף ארנב צפרדע שמש ירח כוכב עץ פרח גשם שלג ענן תפוח בננה עוגה עוגייה פיצה חלב ביצה גלידה סוכרייה כדור בובה עפיפון אופניים מכונית אוטובוס רכבת סירה מטוס בית מיטה כיסא דלת חלון ספר עיפרון צבע כובע נעל מעיל גרב כוס כפית שעון מנורה מפתח קופסה צעצוע דובי רובוט טיל דינוזאור דרקון נסיכה פיראט מלך מלכה טירה אוהל חוף חול צדף בועה בלון קשת ינשוף דבורה נמלה חילזון פרפר צב פינגווין פיל ג׳ירפה זברה נמר פנדה עכבר כבשה עז תרנגולת אפרוח לחם גבינה גזר ענב לימון תפוז תות אבטיח מיץ מרק שיניים יד רגל אף אוזן עין שיער חיוך חיבוק תינוק סבתא מורה רופא חקלאי שף ליצן אחות פעמון תוף גיטרה פסנתר שיר ריקוד מסיבה מתנה נר אמבטיה מגבת סבון מברשת מסרק מראה גינה עציץ נדנדה מגלשה ארגז שלולית מטרייה מגף כפפה צעיף גור חתלתול פוני זחל אגס אפרסק קאפקייק מאפין קוביות פאזל מזחלת ארמון טרקטור קורקינט';

const words = (s) => s.split(/\s+/).filter(Boolean);
const uniq = (a) => [...new Set(a)];
/** The words for a language ('en' | 'he'), set ('std' | 'kids') and categories ([] = all). */
export function wordPool(lang, set = 'std', cats = []) {
  if (set === 'kids') return uniq(words(lang === 'he' ? KIDS_HE : KIDS_EN));
  const src = lang === 'he' ? HE : EN;
  const ids = cats.length ? cats.filter((c) => src[c]) : Object.keys(src);
  return uniq(ids.flatMap((c) => words(src[c])));
}
export const counts = (lang) => ({ std: wordPool(lang).length, kids: wordPool(lang, 'kids').length });
