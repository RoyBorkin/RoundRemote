// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Drinking Games — prompt decks (original wording). Hebrew is written gender-neutral where it reads naturally
// (first-person past tense, infinitive instructions); generic “כל מי ש…” follows the usual Hebrew convention.
// Party card codes: e = everyone, p = one player, d = two players, g = mini-game, v = vote,
// r = a rule that lasts a few turns ("r|rule text|end text"). {A} {B} {C} become random players.

const lines = (s) => s.trim().split('\n').map((x) => x.trim()).filter(Boolean);

export const NEVER = {
  en: {
    mild: lines(`
fallen asleep in a movie theater
sent a text to the wrong person
pretended to know all the words to a song
laughed so hard I cried in public
burned food badly enough to set off the smoke alarm
lied about my age
forgotten a close friend’s birthday
eaten food that fell on the floor
sung karaoke in front of strangers
walked straight into a glass door
looked up an ex online
called a teacher “Mom” or “Dad”
watched a whole season of a show in one day
cried at an animated movie
been on TV
gotten lost in my own neighbourhood
re-gifted a present
pretended to be sick to get out of plans
broken a bone
met a celebrity
searched for my phone while holding it
waved back at someone who wasn’t waving at me
fallen up the stairs
eaten a whole pizza by myself
sent a voice message by accident
gone a whole day without my phone
cut my own hair
dyed my hair a wild colour
been sent out of a class
copied someone’s homework
laughed at a completely wrong moment
ridden a horse
read someone’s messages over their shoulder
locked myself out of my home
tried a recipe from a video and failed spectacularly
given a name to a plant or a car
had a crush on a cartoon character
talked to myself in the mirror for more than a minute
pretended to get a call to escape a conversation
watched a horror movie alone at night
slept through an alarm and missed something important
fallen off a bike in front of people
slept in a tent
done a cartwheel as an adult
accidentally liked a very old photo while scrolling
exaggerated on my CV
had a nickname I secretly hated
walked out of a shop without paying by mistake
tripped in front of someone I liked
forgotten someone’s name seconds after hearing it
sung in the shower loud enough for the neighbours
had breakfast for dinner
played a video game until sunrise
cried during an advert
knocked on the wrong door and didn’t notice for a while
worn the same outfit three days in a row
regretted a haircut the moment I saw it
been stuck in an elevator
taken a selfie with a total stranger
pretended to laugh at a joke I didn’t get
hidden from a neighbour to avoid small talk
lost a bet and had to do something ridiculous
won something in a raffle
eaten a whole jar of something with a spoon
dropped my phone in the toilet
had a sunburn so bad I couldn’t sit
had the same song stuck in my head for a week
said “you too” when a waiter said “enjoy your meal”
run a half marathon
cooked dinner for more than ten people
forgotten where I parked
had an imaginary friend
broken something in a shop
said I read a book I never opened
fallen asleep on a bus or train and missed my stop
gone to a concert alone
gone on a trip without planning anything
eaten something I couldn’t identify
gotten grumpy just because I was hungry
sent a message and deleted it right away
gotten a speeding ticket
stayed awake for more than 24 hours
been on a blind date
put on a fake voice on the phone
pocket-dialled someone
laughed at my own joke before finishing it
eaten dessert before the main course
worn socks with sandals in public
been in a food fight
forgotten my own phone number
been the last one to leave a party
danced on a table
baked a cake that was still raw inside
hit “reply all” by mistake
found money on the street and kept it
photobombed a stranger’s picture
been shushed by a librarian
fake-texted to look busy
cried at a sports game
lost my voice from cheering
gone to the wrong gate at an airport
gotten a song wrong at karaoke and kept going anyway
sneezed during a quiet moment and made everyone jump
hidden a snack so I wouldn’t have to share it
pretended not to see someone to avoid saying hello
`),
    spicy: lines(`
kissed someone I met the same night
gone skinny dipping
had a crush on a friend’s partner
sent a flirty message to the wrong person
made up an excuse to leave a date early
kissed someone who is in this room
used a dating app
ghosted someone
been ghosted
had a crush on a teacher
dated two people at the same time
kissed someone in a car
kissed more than one person in one night
woken up with no idea where I was
kept a relationship secret
snuck someone into my room
been caught kissing by a parent
flirted to get something for free
lied about being single
gone on a date just for the free dinner
had a crush on a friend’s brother or sister
texted an ex after midnight
gotten back together with an ex
scrolled all the way to a crush’s oldest photos
written a love letter
had a crush on someone in this room
been dumped by text
broken up with someone by text
had a holiday romance
used a cheesy pick-up line that actually worked
lied about how many people I’ve dated
kissed someone and regretted it right away
had a fling I never told anyone about
sent a photo I instantly regretted
pretended to be in a relationship to get rid of someone
flirted with a bartender for a better deal
been on a double date that went terribly
fallen asleep on a date
said “I love you” first and heard nothing back
kissed someone on a dare
dreamed about someone in this room
gone through a partner’s phone
worn something just to make an ex jealous
swapped numbers with someone I danced with
stayed out all night and lied about where I was
`),
  },
  he: {
    mild: lines(`
נרדמתי בסרט בקולנוע
שלחתי הודעה לאדם הלא נכון
שרתי קריוקי מול זרים
נתקעתי במעלית
אכלתי משהו שנפל על הרצפה
שיקרתי לגבי הגיל שלי
שכחתי יום הולדת של חבר טוב
צפיתי בעונה שלמה של סדרה ביום אחד
בכיתי מסרט מצויר
נכנסתי ישר לתוך דלת זכוכית
נעלתי את עצמי מחוץ לבית
העמדתי פנים שאני חולה כדי לא ללכת למשהו
שברתי עצם
טסתי לחו״ל לבד
פגשתי מפורסם
חיפשתי את הטלפון כשהוא היה לי ביד
נופפתי למישהו שבכלל לא נופף אליי
אכלתי פיצה שלמה לבד
גזרתי לעצמי את השיער
צבעתי את השיער בצבע מטורף
הוציאו אותי מהכיתה
העתקתי שיעורי בית
צחקתי ברגע הכי לא מתאים
עשיתי בטעות לייק לתמונה ישנה
נרדמתי באוטובוס ופספסתי את התחנה
שכחתי איפה החניתי
נשארתי ער יותר מ-24 שעות
אכלתי קינוח לפני האוכל
רקדתי על שולחן
שלחתי הודעה קולית בטעות
העמדתי פנים שיש לי שיחת טלפון כדי לברוח משיחה
שכחתי שם של מישהו שנייה אחרי ששמעתי אותו
התקשרתי למישהו בטעות מהכיס
קיבלתי דו״ח מהירות
הלכתי להופעה לבד
יצאתי מחנות בלי לשלם בטעות
בישלתי ארוחה ליותר מעשרה אנשים
ניסיתי מתכון מסרטון ונכשלתי לגמרי
נתתי שם לעציץ או לאוטו
שרתי במקלחת בקול רם מדי
עניתי ״גם לך״ למלצר שאמר ״בתאבון״
מצאתי כסף ברחוב ושמרתי אותו
לבשתי את אותם בגדים שלושה ימים ברצף
נשארתי במסיבה עד שכולם הלכו
הפלתי טלפון לאסלה
דפקתי בדלת של הדירה הלא נכונה
`),
    spicy: lines(`
נישקתי מישהו שהכרתי באותו ערב
השתמשתי באפליקציית היכרויות
עשיתי גוסטינג למישהו
קיבלתי גוסטינג
נישקתי מישהו שנמצא בחדר הזה
שלחתי הודעה לאקס אחרי חצות
נדלקתי על בן או בת הזוג של חבר
נפרדתי ממישהו בהודעה
חזרתי לאקס
יצאתי לדייט רק בשביל הארוחה החינמית
פלרטטתי כדי לקבל משהו בחינם
שיקרתי לגבי הסטטוס שלי
היה לי רומן בחופשה
נישקתי מישהו בגלל אתגר
חלמתי על מישהו שנמצא בחדר הזה
עברתי על הטלפון של בן או בת הזוג
התגנבתי הביתה באמצע הלילה
`),
  },
};

export const LIKELY = {
  en: {
    mild: lines(`
become famous
forget their own birthday
survive a zombie apocalypse
cry at a wedding
end up on a reality show
get lost even with GPS
adopt ten cats
eat something off the floor
win the lottery and lose the ticket
start a business that actually works
be late to their own wedding
reply to a message three days later
laugh at the worst possible moment
move to another country on a whim
talk their way out of a parking ticket
fall asleep first tonight
spend a whole paycheck on food
become a meme
get a tattoo they regret
crack their phone screen this week
argue with a vending machine
forget where they parked
make friends with a stranger on the bus
become a millionaire
go viral for something embarrassing
burn water while cooking
lose their keys tonight
give the best wedding speech
cry during a kids’ movie
show up to the wrong party
still be awake at sunrise
get lost in a furniture store
own way too many plants
run for president
host their own cooking show
be late to everything
start the dancing at a party
forget someone’s name mid-conversation
get kicked out of a museum
bring snacks to an emergency
befriend every dog at the park
say something embarrassing on a work call
win a cooking competition
live to 100
quit their job to travel the world
sing in public without being asked
believe a conspiracy theory
become a teacher
`),
    spicy: lines(`
kiss someone tonight
text their ex tonight
fall for a friend’s brother or sister
go on a date with someone they met today
have a secret crush in this room
get married in Vegas
date two people at once
flirt their way out of trouble
get caught sneaking out
send a risky text to the wrong person
leave tonight with someone’s number
have the most chaotic dating history
fall in love on holiday
say “I love you” first
scroll through a crush’s entire profile
get back together with an ex
drop everything for their celebrity crush
get a number at the supermarket
write a love song about someone here
kiss someone at midnight on New Year’s
`),
  },
  he: {
    mild: lines(`
יהיה מפורסם
ישכח את יום ההולדת של עצמו
ישרוד אפוקליפסת זומבים
יבכה בחתונה
יגיע לתוכנית ריאליטי
ילך לאיבוד גם עם ניווט
יאמץ עשרה חתולים
יזכה בלוטו ויאבד את הכרטיס
יענה להודעה אחרי שלושה ימים
יצחק ברגע הכי לא מתאים
יעבור לחו״ל בהחלטה של רגע
יירדם ראשון הערב
יוציא את כל המשכורת על אוכל
יהפוך למם ברשת
יאחר לכל דבר
יתחיל לרקוד ראשון במסיבה
ישכח איפה החנה
יתיידד עם זר באוטובוס
יהיה ויראלי בגלל משהו מביך
ישרוף מים בבישול
יאבד את המפתחות הערב
יחיה עד מאה
יעזוב את העבודה כדי לטייל בעולם
יגיע עם חטיפים למקרה חירום
`),
    spicy: lines(`
ינשק מישהו הערב
ישלח הודעה לאקס הערב
יתאהב בחופשה
יתחתן בלאס וגאס
יחזור לאקס
יקבל מספר טלפון בסופר
`),
  },
};

export const PARTY = {
  en: {
    mild: lines(`
e|Everyone whose phone is below 20% takes a sip.
e|Everyone wearing something black takes a sip.
e|Everyone who travelled abroad this year takes a sip.
e|Last one to touch their nose takes a sip.
e|Everyone with a brother or sister takes a sip.
e|Everyone with a pet hands out a sip.
e|Everyone who has ever broken a bone takes a sip.
e|Anyone driving tonight: you’re on water and you’re the legend of the night. Everyone else toasts you with a sip.
e|The youngest person here takes a sip.
e|The oldest person here hands out 2 sips.
e|Everyone with a tattoo takes a sip.
e|Everyone wearing glasses hands out a sip.
e|Cheers! Everyone takes one sip together.
e|Toast to {A}! Everyone raises a glass and takes a sip.
e|Everyone who checked their phone in the last five minutes takes a sip.
e|Everyone who can’t whistle takes a sip. Prove it!
e|Everyone whose name contains the letter “a” takes a sip.
e|Water round! Everyone takes a big sip of water. 💧
e|Everyone who cried at a movie this year takes a sip.
e|Everyone who has laughed during this game takes a sip.
e|Everyone born in summer takes a sip.
e|Everyone who is wearing socks takes a sip.
e|Everyone who has been to a wedding this year hands out a sip.
p|{A}, hand out 3 sips however you like.
p|{A}, take 2 sips.
p|{A}, tell a joke. If nobody laughs, sip.
p|{A}, do an impression of someone here. If nobody guesses who, sip.
p|{A}, show the last photo you took — or take 2 sips.
p|{A}, name five fruits in ten seconds or take a sip.
p|{A}, swap seats with the person on your left.
p|{A}, you pick the next song. Anyone who complains takes a sip.
p|{A}, say the alphabet backwards from M. Mess up and you sip.
p|{A}, give everyone a compliment. Then everyone else takes a sip.
p|{A}, speak with an accent until your next card.
p|{A}, show us your most useless talent — or sip.
p|{A}, read out the last message you sent — or take 2 sips.
p|{A}, pick someone to have a glass of water with you. Cheers!
p|{A}, balance something on your head for ten seconds. Drop it, sip.
p|{A}, hum a song. Whoever guesses it first hands out 2 sips.
p|{A}, rate everyone’s outfit from 1 to 10. Lowest score takes a sip.
p|{A}, do ten squats or take a sip.
p|{A}, what is the capital of Australia? Wrong answer, sip.
p|{A}, you’re immune for the next card. Lucky you!
p|{A}, tell us something nobody here knows about you — or take 2 sips.
p|{A}, describe your perfect day in three words.
p|{A}, do your best robot dance for five seconds — or sip.
p|{A}, name a song for every letter of your name. Miss one, sip.
p|{A}, choose a player to take a sip. Choose wisely.
p|{A}, guess how many sips you’ve had tonight. Way off? Have a glass of water.
d|{A} and {B} swap a sip.
d|{A} and {B}: staring contest. First to blink takes a sip.
d|{A} and {B}: rock, paper, scissors. Loser sips.
d|{A}, guess {B}’s favourite food. Wrong: you sip. Right: {B} sips.
d|{A} and {B}: thumb war! Loser takes a sip.
d|{A} and {B} swap seats.
d|{A} and {B}: on three, say the same word. Different words? Both sip.
d|{A}, name three things {B} loves in ten seconds. A sip for each miss.
d|{A} and {B}: who’s taller? The shorter one sips. A tie means both.
d|{A}, do an impression of {B}. If {B} isn’t impressed, sip.
d|{A} and {B} clink glasses and both take a sip.
d|{A}, ask {B} anything. {B} answers or takes 2 sips.
d|{A} and {B}: compliment battle. First to run out of compliments sips.
d|{A} vs {B}: lower phone battery takes a sip.
d|{A}, guess the month {B} was born in. Wrong guess, sip.
d|{A}, make up a rhyme about {B}. If it’s good, {B} sips — if not, you do.
d|{A} gives {B} a nickname that sticks for the rest of the game.
d|{A} and {B}: who has the older phone? Its owner sips.
g|Categories! {A} picks a category, then go round the circle. First to blank takes a sip.
g|Rhyme time: {A} says a word, everyone rhymes in turn. First to fail sips.
g|Word chain: {A} says a word; the next person says one that starts with its last letter. Hesitate, sip.
g|Fizz Buzz: count up from 1, say “fizz” for multiples of 3 and “buzz” for multiples of 5. {A} starts. Mistake = sip.
g|Hands on heads! The last person to put a hand on their head takes a sip.
g|The floor is lava! Last one to lift their feet takes a sip.
g|Silence! The first person to speak takes a sip.
g|Countries starting with B — go round from {A}. First to blank sips.
g|Two truths and a lie: {A} goes. Everyone who guesses wrong takes a sip.
g|Picnic memory: {A} names something to bring; each player repeats the list and adds one. Forget one, sip.
g|Thumbs up or down on three! The smaller group takes a sip.
g|Song association: {A} says a word, the next person sings a line with that word. Can’t? Sip.
g|Would you rather: {A} asks one. The smaller group sips.
g|One-word story: {A} starts, everyone adds one word. Whoever breaks the story sips.
g|Trivia: {A} asks {B} a question. Wrong answer, {B} sips. Right answer, {A} sips.
g|Quick round of Never Have I Ever — {A} starts, three statements.
g|Movie quote: {A} says a famous line. First to name the film hands out a sip.
g|Brands: name drink brands going round from {A}. First to repeat or blank sips.
g|Freeze! Everyone freezes right now. First to move takes a sip.
v|Vote on three: who’s the best dancer here? The winner hands out 2 sips.
v|Vote: who’s the worst at keeping secrets? Most votes takes a sip.
v|Vote: who would last longest on a desert island? They hand out 3 sips.
v|Vote: who has the best laugh? Everyone else takes a sip.
v|Vote: who would be the messiest roommate? Most votes sips.
v|Vote: who’ll be late tomorrow? Most votes sips.
v|Vote: who tells the best stories? They pick someone to sip.
v|Vote: who is the most competitive person here? They take a sip.
r|{A} must start every sentence with “please”. Forget, sip.|{A} can stop being so polite now.
r|Nobody may say the word “drink”. Slip up, sip.|You may say “drink” again.
r|{A} is the Question Master: anyone who answers {A}’s questions takes a sip.|{A} is no longer the Question Master.
r|No first names! Saying someone’s name costs a sip.|Names are allowed again.
r|{A} and {B} are drinking buddies: when one sips, so does the other.|{A} and {B} are no longer drinking buddies.
r|Everyone drinks with their other hand. Wrong hand, sip.|Use whichever hand you like again.
r|{A} may only speak in questions. Slip up, sip.|{A} can make statements again.
r|No pointing! Point at someone and you sip.|Pointing is allowed again.
r|{A} is the Thumb Master: when {A} puts a thumb on the table, the last to copy takes a sip.|The Thumb Master’s reign is over.
r|Every time {A} laughs, {A} takes a sip.|{A} can laugh freely again.
r|Say “cheers” to someone before every sip. Forget, sip again.|No more mandatory cheers.
r|{A} ends every sentence with “…in my humble opinion”.|{A} can drop the humble opinions.
r|Swear jar: every swear word costs a sip.|The swear jar is closed.
r|{A} does a tiny dance every time someone sips.|{A} can stop dancing.
r|{A} has to speak in rhymes. Fail, sip.|{A}, normal speech is back.
r|{A} is the snake: anyone who meets {A}’s eyes takes a sip.|The snake has slithered away.
`),
    spicy: lines(`
e|Everyone who kissed someone this month takes a sip.
e|Everyone currently on a dating app takes a sip.
e|Everyone who has ever ghosted someone takes a sip.
e|Everyone with a crush right now takes a sip.
e|Everyone who has kissed someone in this room takes a sip.
e|Everyone who ever snuck home in the middle of the night takes a sip.
e|Everyone who has had a holiday romance takes a sip.
e|Everyone who has dated a colleague takes a sip.
p|{A}, who in this room would you go on a date with? Answer or take 3 sips.
p|{A}, show who you texted last — or take 2 sips.
p|{A}, describe your type in three words.
p|{A}, rate your last date from 1 to 10. Below 5, take a sip.
p|{A}, tell us about your worst date ever — or take 2 sips.
p|{A}, read out your most recent DM — or take 2 sips.
p|{A}, what’s your biggest turn-off? Answer or sip.
p|{A}, who here has the best smile? They hand out a sip.
p|{A}, describe your celebrity crush without saying the name. First to guess hands out 2 sips.
p|{A}, how many people have you kissed this year? Answer or sip.
p|{A}, which ex would you text right now? Answer or take 2 sips.
p|{A}, what’s the boldest thing you’ve done for a crush? Tell us or sip.
p|{A}, kiss the hand of anyone you choose — or take a sip.
p|{A}, reveal today’s screen time — or take 2 sips.
p|{A}, who here would survive a date with you? Pick one — they take a sip.
d|{A} and {B}: whisper a compliment to each other.
d|{A}, slow-dance with {B} for ten seconds — or you both sip.
d|{A}, try your best pick-up line on {B}. If {B} laughs, {B} sips.
d|{A} and {B} swap one item of clothing — a hat, a jacket, a sock.
d|{A}, give {B} a ten-second shoulder rub — or you both sip.
d|{A} and {B}: ten seconds of eye contact. First to laugh takes a sip.
d|{A}, let {B} choose your next profile picture — or take 2 sips.
g|Never Have I Ever, spicy edition: {A} says one. Everyone who has, sips.
v|Vote: who’s the biggest flirt here? Most votes takes a sip.
v|Vote: who has the wildest dating history? They take a sip.
r|{A} has to flirt with everyone who talks to them.|{A} can stop flirting now.
r|{A} and {B} hold hands whenever either of them sips.|{A} and {B} can let go.
r|{A} must wink at whoever they toast before every sip.|No more winking, {A}.
`),
  },
  he: {
    mild: lines(`
e|סוללה מתחת ל-20%? לגימה!
e|יש עליך משהו שחור? לגימה!
e|כל מי שטס לחו״ל השנה — לגימה.
e|כל מי שיש לו אח או אחות — לגימה.
e|כל מי שיש לו חיית מחמד מחלק לגימה.
e|הצעיר ביותר בחדר — לגימה.
e|המבוגר ביותר בחדר מחלק 2 לגימות.
e|לחיים! כולם מרימים כוס לכבוד {A} ולוגמים.
e|סבב מים: כולם לוגמים לגימה גדולה של מים 💧
e|כל מי שמרכיב משקפיים מחלק לגימה.
e|מי שבדק את הטלפון בחמש הדקות האחרונות — לגימה.
e|כל מי שבכה בסרט השנה — לגימה.
e|מי שנוהג הערב שותה רק מים — וכולם מרימים לחיים לכבוד הנהג!
e|כל מי שיש לו קעקוע — לגימה.
e|כל מי שצחק במשחק הזה עד עכשיו — לגימה.
p|{A}, לחלק 3 לגימות איך שבא לך.
p|{A} — 2 לגימות.
p|{A}, לספר בדיחה. אף אחד לא צחק? לגימה.
p|{A}, לעשות חיקוי של מישהו מהחדר. אף אחד לא ניחש? לגימה.
p|{A}, להראות את התמונה האחרונה בגלריה — או 2 לגימות.
p|{A}, חמישה פירות בעשר שניות — או לגימה.
p|{A}, להחליף מקום עם מי שיושב משמאל.
p|התור של {A} לבחור את השיר הבא. מי שמתלונן — לגימה.
p|{A}, להחמיא לכל אחד בחדר — ואז כולם חוץ מ{A} לוגמים.
p|{A}, לדבר במבטא עד הקלף הבא.
p|{A}, לקרוא בקול את ההודעה האחרונה ששלחת — או 2 לגימות.
p|{A}, עשר כפיפות ברכיים — או לגימה.
p|{A}, מה עיר הבירה של אוסטרליה? טעות — לגימה.
p|{A} מקבל חסינות לקלף הבא. איזה מזל!
p|{A}, לספר משהו שאף אחד כאן לא יודע — או 2 לגימות.
p|{A}, לזמזם שיר. מי שמנחש ראשון מחלק 2 לגימות.
p|{A}, לבחור מישהו לשתות איתך כוס מים. לחיים!
d|{A} ו-{B} מחליפים לגימה.
d|{A} ו-{B}: תחרות מבטים. הראשון שממצמץ — לגימה.
d|{A} ו-{B}: אבן, נייר, מספריים. המפסיד לוגם.
d|{A}, לנחש מה האוכל האהוב על {B}. טעות — לגימה ל{A}. צדקת — לגימה ל{B}.
d|{A} ו-{B}: מלחמת אגודלים! המפסיד לוגם.
d|{A} ו-{B} מחליפים מקומות.
d|{A} ו-{B}: על שלוש אומרים מילה באותו רגע. לא אותה מילה? שניכם לוגמים.
d|{A}, לשאול את {B} כל שאלה. תשובה — או 2 לגימות.
d|{A} ו-{B}: קרב מחמאות! למי שנגמרות המחמאות — לגימה.
d|{A} מול {B}: למי יש פחות סוללה? לגימה.
d|{A} ו-{B} — לחיים! שניכם לוגמים.
g|קטגוריות! {A} קובע קטגוריה וממשיכים בסיבוב. מי שנתקע — לגימה.
g|חרוזים: מתחילים במילה של {A}, וכל אחד מוסיף חרוז. מי שנתקע — לגימה.
g|שרשרת מילים, מתחילים מ{A}: כל מילה מתחילה באות האחרונה של הקודמת. היסוס — לגימה.
g|יד על הראש! האחרון ששם יד על הראש — לגימה.
g|הרצפה היא לבה! האחרון שמרים רגליים — לגימה.
g|שקט! הראשון שמדבר — לגימה.
g|שתי אמיתות ושקר — התור של {A}. כל מי שטועה — לגימה.
g|יוצאים לפיקניק: מתחילים מ{A}, כל אחד חוזר על הרשימה ומוסיף פריט. מי ששוכח — לגימה.
g|אגודל למעלה או למטה — על שלוש! הקבוצה הקטנה לוגמת.
g|טריוויה: שאלה מ{A} ל{B}. תשובה שגויה — לגימה ל{B}.
v|הצבעה: מי הרקדן הכי טוב כאן? על שלוש מצביעים. הזוכה מחלק 2 לגימות.
v|הצבעה: מי הכי גרוע בשמירת סודות? הכי הרבה קולות — לגימה.
v|הצבעה: מי ישרוד הכי הרבה זמן על אי בודד? הוא מחלק 3 לגימות.
v|הצבעה: מי יאחר מחר? הכי הרבה קולות — לגימה.
r|{A}: מעכשיו כל משפט מתחיל ב״בבקשה״. שכחת — לגימה.|נגמר עם ה״בבקשה״, {A}.
r|אסור להגיד את המילה ״לשתות״. מי שאומר — לגימה.|מותר שוב להגיד ״לשתות״.
r|שליט השאלות: {A}! מי שעונה לשאלה של {A} — לגימה.|נגמר שלטון השאלות של {A}.
r|אסור להגיד שמות! מי שאומר שם — לגימה.|מותר שוב להגיד שמות.
r|{A} ו-{B} חברי שתייה: כשאחד לוגם, גם השני.|{A} ו-{B} כבר לא חברי שתייה.
r|שותים רק ביד השנייה. טעות — לגימה.|אפשר לשתות בכל יד.
r|אסור להצביע על אף אחד! מי שמצביע — לגימה.|מותר להצביע שוב.
r|קופת קללות: כל קללה עולה לגימה.|קופת הקללות נסגרה.
r|כל צחוק של {A} — לגימה ל{A}.|הצחוק של {A} חופשי שוב.
`),
    spicy: lines(`
e|כל מי שנישק מישהו החודש — לגימה.
e|כל מי שנמצא עכשיו באפליקציית היכרויות — לגימה.
e|כל מי שיש לו קראש כרגע — לגימה.
e|כל מי שהיה לו רומן בחופשה — לגימה.
p|{A}, עם מי מהחדר הכי בא לך לצאת לדייט? תשובה — או 3 לגימות.
p|{A}, להראות למי שלחת את ההודעה האחרונה — או 2 לגימות.
p|{A}, הטיפוס שלך בשלוש מילים.
p|{A}, הדייט הכי גרוע שהיה לך — לספר או 2 לגימות.
p|{A}, לחשוף את זמן המסך של היום — או 2 לגימות.
d|{A} ו-{B}: ללחוש מחמאה אחד לשני.
d|{A} ו-{B}: עשר שניות של קשר עין. הראשון שצוחק — לגימה.
v|הצבעה: מי הכי מפלרטט כאן? הכי הרבה קולות — לגימה.
r|{A} ו-{B} מחזיקים ידיים בכל לגימה.|{A} ו-{B} יכולים לעזוב ידיים.
`),
  },
};

/** Words used around the prompts, per language. */
export const WORDS = {
  en: {
    never: 'Never have I ever…', likely: 'Who’s most likely to…',
    types: { e: 'Everyone', p: 'Your turn', d: 'Pair up', g: 'Mini-game', v: 'Vote', r: 'New rule', x: 'Rule over' },
  },
  he: {
    never: 'אף פעם לא…', likely: 'מי הכי סביר ש…',
    types: { e: 'כולם', p: 'תורך', d: 'זוגות', g: 'משחק', v: 'הצבעה', r: 'חוק חדש', x: 'החוק נגמר' },
  },
};

/** Kings Cup: the default rule for each rank (editable in the game). */
export const KINGS_RULES = {
  A: { t: 'Waterfall', d: 'Everyone starts sipping together. You can stop only after the person before you stops — the drawer stops first.' },
  2: { t: 'You', d: 'Pick someone to take 2 sips.' },
  3: { t: 'Me', d: 'You take 3 sips.' },
  4: { t: 'Floor', d: 'Everyone touches the floor. Last one down takes a sip.' },
  5: { t: 'Jive', d: 'Make a dance move. Next person repeats it and adds one — whoever breaks the chain sips.' },
  6: { t: 'Thumb Master', d: 'You’re the Thumb Master until the next 6: put your thumb on the table any time — last to copy sips.' },
  7: { t: 'Heaven', d: 'Point to the sky! Last one to point takes a sip.' },
  8: { t: 'Mate', d: 'Pick a mate. Whenever you sip, your mate sips too — for the rest of the game.' },
  9: { t: 'Rhyme', d: 'Say a word. Going round, everyone rhymes with it. First to hesitate or repeat sips.' },
  10: { t: 'Categories', d: 'Pick a category (car brands, cheeses…). Going round, name one each. First to blank sips.' },
  J: { t: 'Make a Rule', d: 'Make a rule that lasts the whole game — or play a quick round of Never Have I Ever.' },
  Q: { t: 'Question Master', d: 'Until the next Queen, anyone who answers your questions takes a sip.' },
  K: { t: 'King’s Cup', d: 'Pour a splash of your drink into the King’s Cup. Whoever draws the 4th King drinks it — so keep the splashes tiny!' },
};
