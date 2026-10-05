// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Built-in starter packs for the Tasks app and Truth or Dare: family-friendly truths, dares and tasks
// in English and Hebrew, plus an 18+ set per language (cheeky, flirty, party and drinking challenges for consenting
// adults — suggestive, never explicit; only drawn when 18+ mode is on). A trailing marker adds a tag:
// " #p" party · " #f" funny · " #a" active (moving about). Items get stable ids so they can be hidden or edited like
// any other item: b:<lang>:<t|d|k>:<n> (truth / dare / task), b:<lang>:x<t|d|k>:<n> for the 18+ set.

const EN_TRUTHS = `
What is the most embarrassing thing that happened to you at school? #f
What is a food you pretend to like but secretly don't?
Who in this room would you call first if you won a million?
What is the silliest thing you were afraid of as a little kid? #f
What is your most-used emoji, and why?
If you could swap lives with someone here for a day, who would it be?
What is the last thing you searched for online?
What is a song you know every word of but would never admit to loving? #f
What is your hidden talent?
What is the weirdest dream you remember? #f
Have you ever blamed someone else for something you did?
What is the best gift you have ever received?
What is something you have never told your parents?
What is the strangest food combination you actually enjoy? #f
If you were invisible for a day, what would you do first?
What is the longest you have gone without a shower? #f
Who was your first crush? #p
What is a habit of yours you would like to break?
What is the most trouble you have ever been in?
What do you do when nobody is watching? #f
What is the nicest thing someone in this room has done for you?
If you could only eat one food forever, what would it be?
What is your biggest pet peeve?
What would your perfect day look like?
What is a rule you broke and never got caught for?
Which fictional character do you think you are most like?
What is the most childish thing you still do? #f
Have you ever pretended to be sick to skip something?
What is a compliment you will never forget?
What is your worst haircut story? #f
What app do you spend the most time on?
What is something you are proud of but rarely talk about?
If you had a time machine, where would you go first?
What is your guilty-pleasure TV show?
Who is the funniest person you know?
What is the scariest thing you have ever done?
What is one thing you would change about yourself?
What is the worst present you ever got, and what did you say? #f
Have you ever laughed at the wrong moment? What happened? #f
What is a secret talent you wish you had?
What is the most expensive thing you have ever broken?
What would you name a pet dragon? #f
What is your earliest memory?
What do you think people get wrong about you?
What is the bravest thing you have done this year?
Who here would survive longest on a desert island, and who would not? #p
What is something that always makes you cry?
What is the weirdest thing you have eaten? #f
What is the best advice anyone has given you?
If you were a superhero, what would your weakness be? #f
What is your dream job, honestly?
Which person here do you think is the best cook?
What is a word you always spell wrong?
What is the last lie you told?
What is the most useless thing you own? #f
What is something you are secretly really good at?
What would you do with a whole day of no rules?
Which song would play every time you walk into a room? #f
What is the kindest thing you have done for a stranger?
If you could ask anyone in history one question, who and what would it be?
`;

const EN_DARES = `
Talk like a pirate until your next turn. #f
Do your best impression of someone in this room. #f
Do 10 jumping jacks while singing the alphabet. #a
Let the group give you a new nickname for the rest of the game. #f
Speak only in questions until your next turn. #f
Balance a spoon on your nose for 10 seconds. #a
Dance with no music for 20 seconds. #a
Say the alphabet backwards as fast as you can.
Do your best robot dance. #a
Hum a song and let everyone guess it.
Pretend to be a cat until someone laughs. #f
Make up a short poem about the person on your left.
Walk like a penguin across the room and back. #a
Try to lick your elbow. #f
Hold a plank for 30 seconds. #a
Tell a joke — if nobody laughs, tell another. #f
Do an impression of a famous person and let others guess. #f
Say a tongue twister three times fast: "red lorry, yellow lorry".
Sing the chorus of the last song you listened to.
Act out your favourite movie scene without words. #f
Wear your socks on your hands until your next turn. #f
Give a 30-second speech on why socks are important. #f
Draw a portrait of the player on your right with your eyes closed. #f
Spin around five times, then try to walk in a straight line. #a
Do your best evil laugh. #f
Hop on one foot until your next turn comes back to you. #a
Pretend you are a news reporter and describe this room. #f
Call out the name of every person here in a different accent. #f
Make the funniest face you can and hold it for 10 seconds. #f
Try to juggle three things (soft ones!). #a
Show the last photo on your phone.
Whisper everything you say until your next turn.
Do your best slow-motion run across the room. #a
Let someone draw a tiny smiley on your hand.
Sing everything you say for the next two rounds. #f
Speak in rhymes until your next turn.
Do 15 squats. #a
Pretend to be a waiter and take everyone's order. #f
Stand on one leg with your eyes closed for 15 seconds. #a
Say "banana" in five different emotions. #f
Pretend the floor is lava for the next minute. #a
Make an animal noise and let everyone guess the animal. #f
Do your best superhero landing. #a
Invent a dance move and teach it to everyone. #a
Compliment every player in one sentence each.
Hold your breath for 20 seconds.
Do a cartwheel, or your best try at one. #a
Imitate a baby crying until someone laughs. #f
Try to touch your toes without bending your knees. #a
Pretend to be a statue until your next turn — no laughing. #f
Narrate what the person on your left is doing like a nature documentary. #f
Say something nice about yourself — out loud and proud.
Moonwalk across the room. #a
Do your best opera singing for 10 seconds. #f
Peel a banana with your feet, or pretend to. #f
Balance a book on your head and walk around the table. #a
Keep a straight face while everyone tries to make you laugh. #f
Clap a rhythm and let the next player repeat it.
Name ten animals in ten seconds.
Talk without closing your mouth for one minute. #f
`;

const EN_TASKS = `
Everyone points at who they think will win — the most-pointed-at player loses a turn. #p
Name five countries that start with the letter S in 20 seconds.
Build the tallest tower you can from things on the table in one minute. #a
Find something blue in the room within 10 seconds. #a
Start a story with one sentence; each player adds one more. #p
Swap seats with the player across from you. #a
Make everyone laugh within 30 seconds. #f
Count backwards from 50 in steps of 3 without a mistake.
Name a song for every letter from A to E.
Play rock-paper-scissors with the player on your left — the loser does a dare.
Give everyone a high five in under 10 seconds. #a
Draw a house without lifting your pencil.
Name three things everyone here has in common. #p
Make a paper plane — if it flies past the table, you get a point. #a
Mime an animal; the player who guesses it spins next. #p
Tell everyone one true fact and one fake fact — they guess which is real. #p
Find a word that rhymes with orange (good luck!). #f
Spell your full name backwards.
List five things you can see that are round.
Teach everyone a word in another language.
Sing "Happy Birthday" in a whisper together with everyone. #p
Close your eyes and identify an object someone puts in your hand.
Do the "wave" around the circle three times. #p #a
Say the months of the year in alphabetical order.
Make a funny sound — everyone else has to copy it. #p #f
Hold a staring contest with the player on your right.
Balance a coin on its edge.
Think of a word: everyone gets three yes/no questions to guess it. #p
Name five fruits in five seconds.
Tap your head and rub your belly for 15 seconds. #a
Hum a TV theme tune; the first to guess it gets a point. #p
Arrange everyone by birthday without speaking. #p #a
Create a secret handshake with the player on your left. #a
Say the name of every player from memory, fast.
Tell the group your plan for a zombie apocalypse. #f
Pick a player — you both have to talk like robots until the next spin. #f
Give a 10-second weather report for this room. #f
Count how many people here have brown eyes in 10 seconds.
Describe your morning using only three words.
Thumb-wrestle the player of your choice. #a
`;

const HE_TRUTHS = `
מה הדבר הכי מביך שקרה לך בבית הספר? #f
איזה אוכל אתה מעמיד פנים שאתה אוהב, אבל בעצם לא?
אם היית זוכה במיליון, למי מכאן היית מתקשר ראשון?
ממה פחדת כשהיית קטן, שהיום נראה לך מצחיק? #f
מה הכישרון הסודי שלך?
מה החלום הכי מוזר שאתה זוכר? #f
האם פעם האשמת מישהו אחר במשהו שעשית?
מה המתנה הכי טובה שקיבלת אי פעם?
מה הדבר האחרון שחיפשת באינטרנט?
אם היית בלתי נראה ליום אחד, מה היית עושה קודם?
מי היה האהבה הראשונה שלך? #p
איזה הרגל היית רוצה להפסיק?
מה אתה עושה כשאף אחד לא רואה? #f
מה הדבר הכי נחמד שמישהו כאן עשה בשבילך?
אם היית יכול לאכול רק מאכל אחד לתמיד, מה הוא היה?
איזו דמות מסרט או מספר הכי דומה לך?
מה השיר שאתה יודע את כל המילים שלו ומתבייש בזה? #f
מה המחמאה שלא תשכח לעולם?
אם הייתה לך מכונת זמן, לאן היית נוסע קודם?
מי האדם הכי מצחיק שאתה מכיר?
מה הדבר הכי מפחיד שעשית?
מה הדבר הכי מוזר שאכלת? #f
מה העצה הכי טובה שקיבלת?
מה עבודת החלומות שלך, בכנות?
מה השקר האחרון שסיפרת?
מה הדבר הכי חסר תועלת שיש לך? #f
מה המעשה הכי טוב שעשית לאדם זר?
מה הזיכרון הכי מוקדם שלך?
מי כאן הכי טוב בבישול לדעתך?
איזה שיר היה מתנגן בכל פעם שאתה נכנס לחדר? #f
`;

const HE_DARES = `
דבר כמו פיראט עד התור הבא שלך. #f
עשה חיקוי של מישהו בחדר. #f
עשה 10 קפיצות פיסוק תוך כדי שירת האלף־בית. #a
תן לקבוצה לבחור לך כינוי חדש לשאר המשחק. #f
דבר רק בשאלות עד התור הבא שלך. #f
רקוד בלי מוזיקה במשך 20 שניות. #a
אמור את האלף־בית מהסוף להתחלה כמה שיותר מהר.
עשה ריקוד רובוט. #a
זמזם שיר ותן לכולם לנחש אותו.
העמד פנים שאתה חתול עד שמישהו צוחק. #f
כתוב שיר קצר על השחקן משמאלך.
לך כמו פינגווין עד קצה החדר וחזור. #a
נסה ללקק את המרפק שלך. #f
החזק פלאנק במשך 30 שניות. #a
ספר בדיחה — אם אף אחד לא צוחק, ספר עוד אחת. #f
שחק את הסצנה האהובה עליך מסרט, בלי מילים. #f
עשה את הצחוק המרושע הכי טוב שלך. #f
קפוץ על רגל אחת עד שהתור יחזור אליך. #a
העמד פנים שאתה כתב חדשות ותאר את החדר. #f
עשה את הפרצוף הכי מצחיק שאתה יכול והחזק אותו 10 שניות. #f
לחש כל מה שאתה אומר עד התור הבא שלך.
שיר כל מה שאתה אומר בשני הסיבובים הבאים. #f
עשה 15 כפיפות ברכיים. #a
העמד פנים שאתה מלצר וקח הזמנה מכולם. #f
עמוד על רגל אחת בעיניים עצומות 15 שניות. #a
השמע קול של חיה ותן לכולם לנחש איזו. #f
המצא תנועת ריקוד ולמד את כולם. #a
תן מחמאה לכל שחקן במשפט אחד.
הפוך לפסל עד התור הבא שלך — אסור לצחוק. #f
מנה עשר חיות בעשר שניות.
`;

const HE_TASKS = `
כולם מצביעים על מי שלדעתם ינצח — מי שקיבל הכי הרבה הצבעות מפסיד תור. #p
מנה חמש מדינות שמתחילות באות א׳ תוך 20 שניות.
בנה את המגדל הכי גבוה מדברים שעל השולחן בדקה אחת. #a
מצא משהו כחול בחדר תוך 10 שניות. #a
התחל סיפור במשפט אחד; כל שחקן מוסיף משפט. #p
החלף מקום עם השחקן שמולך. #a
הצחק את כולם תוך 30 שניות. #f
ספור לאחור מ־50 בקפיצות של 3 בלי טעות.
שחק אבן־נייר־ומספריים עם השחקן משמאלך — המפסיד מבצע משימה.
תן כיף לכולם בפחות מ־10 שניות. #a
צייר בית בלי להרים את העיפרון.
מצא שלושה דברים שמשותפים לכל מי שכאן. #p
עשה פנטומימה של חיה; מי שמנחש מסובב את הבקבוק. #p
ספר לכולם עובדה אמיתית אחת ועובדה מומצאת אחת — שינחשו מה נכון. #p
אמור את השם המלא שלך מהסוף להתחלה.
מנה חמישה דברים עגולים שאתה רואה.
למד את כולם מילה בשפה אחרת.
עצום עיניים וזהה חפץ שמישהו שם לך ביד.
עשו "גל" סביב המעגל שלוש פעמים. #p #a
השמע צליל מצחיק — כל השאר צריכים לחקות אותו. #p #f
עשה תחרות בהייה עם השחקן מימינך.
חשוב על מילה: לכל אחד יש שלוש שאלות כן/לא כדי לנחש אותה. #p
מנה חמישה פירות בחמש שניות.
טפח על הראש ושפשף את הבטן במשך 15 שניות. #a
זמזם שיר פתיחה של תוכנית; הראשון שמנחש מקבל נקודה. #p
סדרו את עצמכם לפי יום ההולדת — בלי לדבר. #p #a
המצא לחיצת יד סודית עם השחקן משמאלך. #a
אמור את השם של כל השחקנים בעל־פה, מהר.
ספר לקבוצה מה התוכנית שלך למקרה של מתקפת זומבים. #f
תאר את הבוקר שלך בשלוש מילים בלבד.
`;

// ---------------------------------------------------------------- 18+ (adults only; skippable like every card)
// "A sip" means any drink — water counts.

const EN_X_TRUTHS = `
Who in this room would you most like to go on a date with? #p
What is the cheesiest pick-up line you have ever used — and did it work? #f
What is the most embarrassing thing you have done to impress a crush? #f
Have you ever sent a flirty text to the wrong person? What did it say? #f
What is your biggest turn-off on a first date?
What is the worst date you have ever been on? #f
Have you ever had a crush on a friend's partner?
What is the most daring thing you have done on a night out? #p
Who is your guilty-pleasure celebrity crush?
Who here would make the best wingman, and who the worst? #p
Have you ever ghosted someone? Why?
What is the most embarrassing thing you have done while tipsy? #f
How far back have you scrolled on an ex's social media? #f
What is the strangest place you have fallen asleep after a party? #f
What would your dating-app bio say if it had to be 100% honest? #f
Have you ever lied about your age? To whom?
What is the most romantic thing anyone has done for you?
What is your go-to move when you are flirting? #f
Tell the story of your most awkward kiss — no names needed. #f
Rate your own flirting skills from 1 to 10 — the group gets to argue. #p
What is something you would only admit after two drinks?
Have you ever been thrown out of a bar or a club? #f
What is the cringiest late-night text you have ever sent? #f
Who here gives off the most mysterious vibes? #p
What is the biggest lie you have told on a date?
Have you ever been caught checking someone out? #f
What is your most unpopular dating opinion?
What is the worst hangover you have ever had, and what caused it? #f
If you had to marry someone in this room, who would it be? #p
Have you ever pretended to love a gift from a partner?
What was your most embarrassing moment on a dance floor? #f
Have you ever had a secret relationship?
What is the boldest message you have ever sent to a crush?
Which ex would you still pick up the phone for at 2 a.m.?
What is your biggest red flag, honestly? #f
Who here do you think has the most secret admirers? #p
Have you ever fallen for someone at first sight? What happened?
What is the most embarrassing song you have sung at karaoke? #f
What is something you find attractive that most people don't?
What is the worst pick-up line anyone has tried on you? #f
Have you ever forgotten someone's name right after kissing them? #f
Which celebrity would you leave this party for, right now? #f
What is the most awkward way you have been dumped — or dumped someone?
Who here would you want next to you at a wild party, and why? #p
What is the most spontaneous thing you have done after midnight?
What is the weirdest thing you have found attractive on a date? #f
Which player here would you swap phones with for a day — and who never? #p
What is your most-used flirty emoji, and who got it last? #f
What is the longest you have gone without a date, honestly?
What is the most money you have spent trying to impress someone?
`;

const EN_X_DARES = `
Take a sip of your drink without using your hands. #f
Read out the last message you sent to your crush or partner — or take two sips. #p
Do your best seductive slow-motion walk across the room. #f #a
Serenade the player on your left with a love song. #f
Try your best pick-up line on the player across from you. #f
Show the group the last photo you took on a night out. #p
Give the player on your right a 30-second shoulder rub — only if they say yes. #p
Do a dramatic movie-style proposal to the player of your choice. #f
Whisper a compliment into someone's ear. #p
Give everyone your best flirty wink, one at a time. #f
Dance like nobody's watching for 30 seconds — everyone is. #a #f
Take a selfie with the player you think looks best tonight. #p
Talk in a sultry voice until your next turn. #f
Let the player on your left choose your next drink (water counts). #p
Raise a toast to the most charming person here. #p
Act out how you flirt at a bar — the group plays the bartender. #f
Slow-dance with the player of your choice for 20 seconds, if they agree. #a
Read your latest search history out loud — or take two sips. #f
Swap one piece of clothing (a jacket, hat, socks…) with another player. #f
Show the oldest photo of yourself on your phone. #f
Show off your sexiest dance move — keep it PG-13! #a #f
Describe your ideal date using only movie titles. #f
Rate everyone's outfit tonight like a strict fashion critic. #f #p
Act like a very nervous person on a first date for one minute. #f
Send a harmless "thinking of you" text to the third person in your contacts. #p
Do your smoothest body roll. #a #f
Do your best impression of someone drunk-texting their ex. #f
Give a heartfelt toast to tonight's host. #p
Take a sip every time someone says your name until your next turn. #p
Hold eye contact with the player across from you for 30 seconds without laughing. #p
Speak only in pick-up lines until your next turn. #f
Let the player on your right restyle your hair however they like. #f
Show the group your dating-app profile, or act out what it would say. #f
Do a 15-second TV commercial for your favourite drink. #f
Strut across the room like it's a catwalk. #a #f
Kiss the hand of the player on your left like in an old film — if they agree. #p
Let the group read your last three messages — or take two sips. #p
Sing the chorus of a love song to the bottle. #f
Make up a cheesy love poem for the player across from you. #f
Put on a cocktail-bartender show with whatever is on the table. #f #a
Describe your celebrity crush without saying the name — the group guesses. #p
Let someone draw a little heart on your cheek (with something washable). #f
Act out a dramatic break-up scene with the player of your choice. #f
Do your best impression of yourself after three drinks. #f
Propose a toast in your best fake French accent. #f
Give a dramatic reading of the last message you received. #f
Text your best friend "I have something to tell you…" and reveal it's a game after five minutes. #f
Pay someone your most charming compliment while holding eye contact. #p
Do 10 push-ups — or take a sip for every one you skip. #a
Let the group pick a new flirty nickname for you for the rest of the night. #f
`;

const EN_X_TASKS = `
Never have I ever: say one thing you've never done — everyone who has done it takes a sip. #p
Everyone points at who is most likely to text an ex tonight — the winner takes a sip. #p
Everyone who is single takes a sip. #p
Everyone in a relationship takes a sip. #p
Pick a drinking buddy: whenever you sip, they sip, until your next turn. #p
Make up a rule — anyone who breaks it takes a sip until the next spin. #p
Categories: take turns naming cocktails — the first to get stuck takes a sip. #p
You are the thumb master: when you put your thumb on the table, the last to copy takes a sip. #p
Everyone who has been on a date this month takes a sip. #p
Two truths and a lie about your love life — everyone who guesses wrong takes a sip. #p
Whoever has the oldest message from an ex on their phone takes a sip. #f
Rhyme time: say a word, go round the circle rhyming — the first to fail takes a sip. #p
Best kisser vote: on three, everyone points at someone. The most-pointed-at gets a toast. #p #f
Everyone shows their last-used emoji — the most boring one takes a sip. #p #f
Social! Everyone raises a glass and takes a sip together. #p
Question master: until your next turn, anyone who answers your questions takes a sip. #p
Pick two players to swap seats and talk like each other until the next spin. #f
Call heads or tails and flip a coin — wrong means a sip. #f
Everyone who has ever drunk-texted takes a sip. #p #f
Whoever has the most recent kiss story tells it — or takes two sips. #p
Snake eyes: until your next turn, anyone who meets your eyes takes a sip. #p
Everyone who has ever been on a blind date takes a sip. #p
Hot seat: the group asks you three rapid-fire questions — every one you pass is a sip. #p
Name three celebrity crushes in 10 seconds — or take a sip. #f
The last person to touch their nose takes a sip. #a #p
Everyone who used a dating app this year takes a sip. #p
Accent round: everyone speaks with a French accent until the next spin — every slip costs a sip. #f
Pick a "date" for the round: you two sit together until the next spin. #p
Famous couples: go round naming them — the first to repeat one or freeze takes a sip. #p
A toast to love — everyone who has ever been in love takes a sip. #p
`;

const HE_X_TRUTHS = `
עם מי בחדר הזה היית רוצה לצאת לדייט? #p
מה משפט הפתיחה הכי מביך שניסית — והאם זה עבד? #f
מה הדבר הכי מביך שעשית כדי להרשים מישהו שמצא חן בעיניך? #f
האם שלחת פעם הודעה מפלרטטת לאדם הלא נכון? מה היה כתוב בה? #f
מה הדייט הכי גרוע שהיית בו? #f
האם פעם נדלקת על בן או בת הזוג של חבר?
מה הדבר הכי נועז שעשית ביציאה בלילה? #p
על איזה סלב אתה נדלק בסתר?
האם פעם נעלמת למישהו בלי להסביר? למה?
מה הדבר הכי מביך שעשית כשהיית שתוי? #f
כמה אחורה גללת פעם ברשתות של אקס? #f
מה הדבר הכי רומנטי שמישהו עשה בשבילך?
מה המהלך הקבוע שלך כשאתה מפלרטט? #f
דרג את יכולות הפלרטוט שלך מ־1 עד 10 — והקבוצה תתווכח. #p
מה ההודעה הכי מביכה ששלחת באמצע הלילה? #f
מה השקר הכי גדול שסיפרת בדייט?
האם פעם תפסו אותך בוהה במישהו? #f
מה דעה לא פופולרית שיש לך על דייטים?
מה ההנגאובר הכי קשה שהיה לך, וממה? #f
אם היית חייב להתחתן עם מישהו מהחדר, מי זה היה? #p
האם הייתה לך פעם מערכת יחסים סודית?
מה הדגל האדום הכי גדול שלך, בכנות? #f
למי כאן יש לדעתך הכי הרבה מעריצים סודיים? #p
האם התאהבת פעם ממבט ראשון? מה קרה?
מה השיר הכי מביך ששרת בקריוקי? #f
מה משפט הפתיחה הכי גרוע שמישהו ניסה עליך? #f
בשביל איזה סלב היית עוזב את המסיבה הזאת עכשיו? #f
מה הפרידה הכי מביכה שהייתה לך?
מה הדבר שהיית מודה בו רק אחרי שתי כוסות?
מי כאן נראה לך הכי מסתורי? #p
`;

const HE_X_DARES = `
קח שלוק מהמשקה שלך בלי להשתמש בידיים. #f
הקרא את ההודעה האחרונה ששלחת לבן או בת הזוג — או קח שני שלוקים. #p
עשה הליכה מפתה בהילוך איטי לאורך החדר. #f #a
שיר שיר אהבה לשחקן משמאלך. #f
נסה את משפט הפתיחה הכי טוב שלך על השחקן שמולך. #f
עשה הצעת נישואין דרמטית כמו בסרטים לשחקן לבחירתך. #f
לחש מחמאה באוזן של מישהו. #p
קרוץ קריצה מפלרטטת לכל אחד בתורו. #f
רקוד כאילו אף אחד לא רואה במשך 30 שניות — כולם רואים. #a #f
דבר בקול מפתה עד התור הבא שלך. #f
תן לשחקן משמאלך לבחור לך את המשקה הבא (גם מים נחשבים). #p
הרם כוסית לכבוד האדם הכי מקסים כאן. #p
רקוד סלואו 20 שניות עם שחקן לבחירתך, אם הוא מסכים. #a
הקרא בקול את החיפוש האחרון שלך — או קח שני שלוקים. #f
החלף פריט לבוש (כובע, ז׳קט, גרביים…) עם שחקן אחר. #f
הראה את התמונה הכי ישנה שלך בטלפון. #f
עשה את תנועת הריקוד הכי סקסית שלך — בגבולות הטעם הטוב! #a #f
תאר את הדייט המושלם שלך רק בשמות של סרטים. #f
דרג את הלבוש של כולם כמו מבקר אופנה קשוח. #f #p
שחק מישהו לחוץ בדייט ראשון במשך דקה. #f
קח שלוק בכל פעם שמישהו אומר את השם שלך, עד התור הבא שלך. #p
החזק קשר עין עם השחקן שמולך 30 שניות בלי לצחוק. #p
דבר רק במשפטי פתיחה עד התור הבא שלך. #f
עשה חיקוי של עצמך אחרי שלוש כוסות. #f
כתוב שיר אהבה מתקתק לשחקן שמולך. #f
תאר את הסלב שאתה נדלק עליו בלי להגיד את שמו — הקבוצה מנחשת. #p
צעד לאורך החדר כמו על מסלול תצוגת אופנה. #a #f
שלח לחבר הכי טוב שלך "יש לי משהו לספר לך…" וגלה לו אחרי חמש דקות שזה רק משחק. #f
עשה 10 שכיבות סמיכה — או קח שלוק על כל אחת שדילגת. #a
נשק את היד של השחקן משמאלך כמו בסרט ישן — אם הוא מסכים. #p
`;

const HE_X_TASKS = `
"אף פעם לא": אמור משהו שמעולם לא עשית — כל מי שכן עשה לוקח שלוק. #p
כולם מצביעים על מי שהכי סביר שישלח הודעה לאקס הלילה — הוא לוקח שלוק. #p
כל הרווקים והרווקות לוקחים שלוק. #p
כל מי שבזוגיות לוקח שלוק. #p
בחר שותף לשתייה: בכל פעם שאתה שותה, גם הוא שותה — עד התור הבא שלך. #p
קבע חוק: מי שמפר אותו לוקח שלוק, עד הסיבוב הבא. #p
קטגוריות: מנו קוקטיילים בתורות — מי שנתקע לוקח שלוק. #p
שתי אמיתות ושקר על חיי האהבה שלך — כל מי שטועה לוקח שלוק. #p
כל מי שהיה בדייט החודש לוקח שלוק. #p
לחיים! כולם מרימים כוסית ולוקחים שלוק ביחד. #p
מי שיש לו בטלפון את ההודעה הכי ישנה מאקס לוקח שלוק. #f
הכיסא החם: הקבוצה שואלת אותך שלוש שאלות מהירות — כל שאלה שאתה מדלג עליה היא שלוק. #p
מנה שלושה סלבס שאתה נדלק עליהם תוך 10 שניות, או קח שלוק. #f
האחרון שנוגע באף לוקח שלוק. #a #p
כל מי שהשתמש באפליקציית היכרויות השנה לוקח שלוק. #p
כולם מדברים במבטא צרפתי עד הסיבוב הבא — מי שמתבלבל לוקח שלוק. #f
בחר "דייט" לסיבוב: שניכם יושבים יחד עד הסיבוב הבא. #p
כוסית לאהבה — כל מי שהיה פעם מאוהב לוקח שלוק. #p
`;

const TAG = { p: 'party', f: 'funny', a: 'active' };
const LETTER = { truth: 't', dare: 'd', task: 'k' };
function parse(src, lang, type, adult = false) {
  return src.trim().split('\n').map((line, i) => {
    const tags = [adult ? '18+' : 'family'];
    const text = line.replace(/\s+#([pfa])\b/g, (_, t) => { tags.push(TAG[t]); return ''; }).trim();
    return { id: `b:${lang}:${adult ? 'x' : ''}${LETTER[type]}:${i + 1}`, type, text, author: '', tags, session: '', created: 0, updated: 0, builtin: lang };
  });
}

export const PACKS = {
  en: { name: 'English starter pack', items: [...parse(EN_TRUTHS, 'en', 'truth'), ...parse(EN_DARES, 'en', 'dare'), ...parse(EN_TASKS, 'en', 'task'),
    ...parse(EN_X_TRUTHS, 'en', 'truth', true), ...parse(EN_X_DARES, 'en', 'dare', true), ...parse(EN_X_TASKS, 'en', 'task', true)] },
  he: { name: 'חבילת פתיחה בעברית', items: [...parse(HE_TRUTHS, 'he', 'truth'), ...parse(HE_DARES, 'he', 'dare'), ...parse(HE_TASKS, 'he', 'task'),
    ...parse(HE_X_TRUTHS, 'he', 'truth', true), ...parse(HE_X_DARES, 'he', 'dare', true), ...parse(HE_X_TASKS, 'he', 'task', true)] },
};
