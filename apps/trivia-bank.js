// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Trivia Night — the built-in English question bank (all original wording). One line per question:
//   difficulty (1 easy · 2 medium · 3 hard) | question | correct answer | wrong | wrong | wrong
// Facts are the kind that don't change; anything "current" (records, rankings) is avoided or dated in the question.
export const CATS = [
  { id: 'general', name: 'General knowledge', he: 'ידע כללי', color: '#60a5fa', icon: '💡' },
  { id: 'science', name: 'Science & nature', he: 'מדע וטבע', color: '#34d399', icon: '🔬' },
  { id: 'geo', name: 'Geography', he: 'גאוגרפיה', color: '#22d3ee', icon: '🌍' },
  { id: 'history', name: 'History', he: 'היסטוריה', color: '#f59e0b', icon: '🏛️' },
  { id: 'music', name: 'Music', he: 'מוזיקה', color: '#f472b6', icon: '🎵' },
  { id: 'screen', name: 'Movies & TV', he: 'קולנוע וטלוויזיה', color: '#a78bfa', icon: '🎬' },
  { id: 'sports', name: 'Sports', he: 'ספורט', color: '#f97316', icon: '⚽' },
  { id: 'food', name: 'Food & drink', he: 'אוכל ושתייה', color: '#facc15', icon: '🍕' },
  { id: 'tech', name: 'Tech', he: 'טכנולוגיה', color: '#94a3b8', icon: '💻' },
  { id: 'israel', name: 'Israel', he: 'ישראל', color: '#3b82f6', icon: '🇮🇱' },
];

export const EN = {
  general: `
1|How many days are there in a leap year?|366|365|364|367
1|Which colour do you get by mixing blue and yellow paint?|Green|Purple|Orange|Brown
1|How many sides does a hexagon have?|6|5|7|8
1|How many minutes are there in three hours?|180|120|160|200
1|In which game would a player announce “checkmate”?|Chess|Checkers|Go|Backgammon
1|How many colours are traditionally listed in a rainbow?|7|6|8|5
1|How many cards are in a standard deck, without jokers?|52|54|48|50
1|What is the plural of “mouse” (the animal)?|Mice|Mouses|Meese|Mousen
1|Which month of the year has the fewest days?|February|April|June|November
1|How many zeros are there in one million?|6|5|7|9
1|Which insect makes honey?|The bee|The wasp|The ant|The butterfly
1|What number does the Roman numeral X stand for?|10|5|50|100
2|What number does the Roman numeral L stand for?|50|100|500|5
2|Which Roman numeral stands for 1,000?|M|D|C|K
1|How many sides does a pentagon have?|5|4|6|7
2|What is a baby kangaroo called?|A joey|A cub|A kid|A calf
2|What is a group of lions called?|A pride|A pack|A herd|A flock
1|How many legs does a spider have?|8|6|10|12
1|What is the largest animal alive today?|The blue whale|The African elephant|The whale shark|The giraffe
1|How many years are there in a millennium?|1,000|100|10,000|500
2|At how many degrees Fahrenheit does water freeze?|32|0|100|212
1|What is the name of the fairy in “Peter Pan”?|Tinker Bell|Flora|Navi|Fauna
1|What colour is an emerald?|Green|Red|Blue|Purple
1|Who wrote the play “Romeo and Juliet”?|William Shakespeare|Charles Dickens|Jane Austen|Mark Twain
1|Who painted the Mona Lisa?|Leonardo da Vinci|Michelangelo|Raphael|Vincent van Gogh
2|Who wrote the novel “Pride and Prejudice”?|Jane Austen|Charlotte Brontë|Emily Dickinson|Virginia Woolf
2|Which author created the detective Sherlock Holmes?|Arthur Conan Doyle|Agatha Christie|Edgar Allan Poe|Charles Dickens
1|Who painted “The Starry Night”?|Vincent van Gogh|Claude Monet|Pablo Picasso|Salvador Dalí
2|How many squares are there on a chessboard?|64|81|49|100
2|In Monopoly, what colour are the two most expensive properties?|Dark blue|Green|Red|Yellow
1|What is the currency of Japan?|Yen|Won|Yuan|Ringgit
1|What is the currency of the United Kingdom?|Pound sterling|Euro|Dollar|Franc
2|Which language has the most native speakers in the world?|Mandarin Chinese|English|Spanish|Hindi
3|In which country was the Rubik’s Cube invented?|Hungary|Japan|Germany|Russia
1|What is the fastest land animal?|The cheetah|The lion|The pronghorn|The greyhound
3|How many hearts does an octopus have?|3|1|2|8
2|What do you call a word that reads the same backwards, like “level”?|A palindrome|An anagram|An acronym|A homophone`,

  science: `
1|What is the chemical symbol for gold?|Au|Ag|Gd|Go
2|What is the chemical symbol for sodium?|Na|So|Sd|S
1|Which gas do plants take in from the air to make food?|Carbon dioxide|Oxygen|Nitrogen|Hydrogen
1|Which planet is closest to the Sun?|Mercury|Venus|Mars|Earth
1|Which is the largest planet in our solar system?|Jupiter|Saturn|Neptune|Earth
1|Which planet is known as the Red Planet?|Mars|Venus|Jupiter|Mercury
1|How many planets are there in our solar system?|8|9|7|10
1|What is the hardest natural substance?|Diamond|Quartz|Granite|Iron
2|Roughly how fast does light travel in a vacuum?|300,000 km per second|30,000 km per second|3,000 km per second|3 million km per second
2|Which part of a cell holds most of its DNA?|The nucleus|The ribosome|The cell membrane|The cytoplasm
2|What is the largest organ of the human body?|The skin|The liver|The brain|The lungs
2|How many bones are there in an adult human body?|206|186|226|306
3|What is the smallest bone in the human body?|The stapes (stirrup)|The incus (anvil)|The hyoid|The coccyx
1|At what temperature does water boil at sea level, in Celsius?|100°|90°|80°|120°
1|Who developed the theory of general relativity?|Albert Einstein|Isaac Newton|Niels Bohr|Galileo Galilei
1|Who described the three laws of motion?|Isaac Newton|Albert Einstein|Galileo Galilei|Johannes Kepler
2|Which gas makes up most of Earth’s atmosphere?|Nitrogen|Oxygen|Carbon dioxide|Argon
2|What is the atomic number of carbon?|6|12|8|4
2|Which element has the chemical symbol Fe?|Iron|Fluorine|Lead|Francium
3|Which element has the chemical symbol K?|Potassium|Krypton|Calcium|Cobalt
1|What kind of animal is a dolphin?|A mammal|A fish|An amphibian|A reptile
1|What do we call an animal that eats only plants?|A herbivore|A carnivore|An omnivore|An insectivore
2|About how long does sunlight take to reach Earth?|About 8 minutes|About 8 seconds|About an hour|About a day
2|What is the pH of pure water at room temperature?|7|0|1|14
3|Which blood type can be given to almost anyone (the universal red-cell donor)?|O negative|AB positive|A positive|B negative
2|Which star is closest to Earth?|The Sun|Proxima Centauri|Sirius|Polaris
1|Which planet has the biggest, brightest rings?|Saturn|Jupiter|Uranus|Neptune
1|Which part of the cell is often called its “powerhouse”?|The mitochondria|The nucleus|The Golgi apparatus|The ribosome
2|Which vitamin does your skin make in sunlight?|Vitamin D|Vitamin C|Vitamin A|Vitamin B12
3|At which temperature do the Celsius and Fahrenheit scales show the same number?|−40|0|−32|100
2|What is the centre of an atom called?|The nucleus|The electron|The neutrino|The photon
1|What does a caterpillar turn into?|A butterfly or moth|A beetle|A dragonfly|A grasshopper
2|Which planet spins on its side, with an axis tilted about 98 degrees?|Uranus|Neptune|Saturn|Venus`,

  geo: `
1|What is the capital of France?|Paris|Lyon|Marseille|Nice
1|What is the capital of Japan?|Tokyo|Kyoto|Osaka|Seoul
2|What is the capital of Australia?|Canberra|Sydney|Melbourne|Perth
2|What is the capital of Canada?|Ottawa|Toronto|Vancouver|Montreal
1|Which is the largest ocean on Earth?|The Pacific|The Atlantic|The Indian|The Arctic
1|Which is the longest river in Africa?|The Nile|The Congo|The Niger|The Zambezi
2|What is the largest hot desert in the world?|The Sahara|The Gobi|The Kalahari|The Arabian
2|Which is the smallest country in the world by area?|Vatican City|Monaco|San Marino|Liechtenstein
2|Mount Everest sits on the border between Nepal and which country?|China|India|Bhutan|Pakistan
1|How many continents are there, by the most common count?|7|5|6|8
1|Which is the largest country in the world by area?|Russia|Canada|China|The United States
1|What is the capital of Italy?|Rome|Milan|Venice|Naples
1|What is the capital of Spain?|Madrid|Barcelona|Seville|Valencia
1|What is the capital of Germany?|Berlin|Munich|Frankfurt|Hamburg
2|In which country is Machu Picchu?|Peru|Bolivia|Chile|Mexico
1|The Great Barrier Reef lies off the coast of which country?|Australia|New Zealand|Indonesia|The Philippines
1|Which river flows through London?|The Thames|The Seine|The Danube|The Rhine
2|Which river flows through Paris?|The Seine|The Loire|The Rhône|The Thames
1|What is the capital of Egypt?|Cairo|Alexandria|Giza|Luxor
2|What is the highest mountain in Africa?|Kilimanjaro|Mount Kenya|Mount Toubkal|Table Mountain
2|Which is the largest US state by area?|Alaska|Texas|California|Montana
2|What is the capital of Turkey?|Ankara|Istanbul|Izmir|Antalya
2|In which country is the city of Marrakesh?|Morocco|Tunisia|Egypt|Algeria
2|What is the capital of Brazil?|Brasília|Rio de Janeiro|São Paulo|Salvador
1|Which sea lies between Europe and Africa?|The Mediterranean|The Red Sea|The Black Sea|The Caspian Sea
2|Where is the lowest point on dry land on Earth?|The shore of the Dead Sea|Death Valley|The Caspian Depression|Lake Assal
3|What is the capital of New Zealand?|Wellington|Auckland|Christchurch|Queenstown
3|Which African country was once known as Abyssinia?|Ethiopia|Eritrea|Somalia|Sudan
2|What is the capital of Iceland?|Reykjavík|Oslo|Helsinki|Nuuk
2|Which strait separates Spain from Morocco?|The Strait of Gibraltar|The Bosphorus|The Strait of Hormuz|The Strait of Messina
1|On which continent is Kenya?|Africa|Asia|South America|Oceania
3|Which country has the longest coastline in the world?|Canada|Australia|Russia|Indonesia`,

  history: `
1|In which year did World War II end?|1945|1944|1946|1939
2|In which year did World War I begin?|1914|1912|1916|1918
1|Who was the first President of the United States?|George Washington|Thomas Jefferson|Abraham Lincoln|John Adams
1|In which year did people first land on the Moon?|1969|1965|1972|1959
1|Who was the first person to walk on the Moon?|Neil Armstrong|Buzz Aldrin|Yuri Gagarin|Michael Collins
2|Who was the first human to travel into space?|Yuri Gagarin|Neil Armstrong|Alan Shepard|John Glenn
2|In which year did the Berlin Wall fall?|1989|1991|1987|1985
1|Which ancient people built the great pyramids of Giza?|The Egyptians|The Romans|The Greeks|The Persians
2|Who was the first woman to win a Nobel Prize?|Marie Curie|Rosalind Franklin|Ada Lovelace|Florence Nightingale
2|In which year did the Titanic sink?|1912|1905|1915|1920
2|Which city was the capital of the Byzantine Empire?|Constantinople|Rome|Athens|Alexandria
2|Who was the main author of the US Declaration of Independence?|Thomas Jefferson|George Washington|Benjamin Franklin|John Adams
2|Which ship carried the Pilgrims to America in 1620?|The Mayflower|The Santa María|The Endeavour|The Beagle
1|In which year did Columbus first reach the Americas?|1492|1498|1488|1502
1|Who was Britain’s prime minister for most of World War II?|Winston Churchill|Neville Chamberlain|Clement Attlee|Anthony Eden
2|At which battle was Napoleon finally defeated in 1815?|Waterloo|Austerlitz|Trafalgar|Borodino
1|Which country gave the Statue of Liberty to the United States?|France|The United Kingdom|Spain|Italy
2|In which country did the Industrial Revolution begin?|Britain|Germany|The United States|France
1|Which Egyptian queen was an ally of Mark Antony?|Cleopatra|Nefertiti|Hatshepsut|Nefertari
2|In which country did the Renaissance begin?|Italy|France|England|Spain
2|In which year did the French Revolution begin?|1789|1776|1799|1815
1|Who became South Africa’s first democratically elected president?|Nelson Mandela|Desmond Tutu|F. W. de Klerk|Thabo Mbeki
2|Which volcano buried the Roman city of Pompeii?|Vesuvius|Etna|Stromboli|Olympus
2|Whose expedition was the first to sail all the way around the world?|Ferdinand Magellan’s|Vasco da Gama’s|James Cook’s|Francis Drake’s
1|The Cold War was mostly a rivalry between the United States and…|The Soviet Union|China|Germany|Cuba
2|Who introduced printing with movable metal type in Europe around 1440?|Johannes Gutenberg|Leonardo da Vinci|Galileo Galilei|Martin Luther
2|In which year did the Soviet Union break up?|1991|1989|1993|1985
2|Which civilisation built Machu Picchu?|The Inca|The Maya|The Aztecs|The Olmecs
3|Who was the first emperor of Rome?|Augustus|Julius Caesar|Nero|Caligula
3|In which year was the Magna Carta sealed?|1215|1066|1415|1314
2|In which year was the Battle of Hastings?|1066|1166|966|1215
3|Which ancient wonder stood in the harbour of Rhodes?|The Colossus|The Lighthouse|The Mausoleum|The Hanging Gardens`,

  music: `
1|How many strings does a standard guitar have?|6|4|5|7
2|How many keys does a standard piano have?|88|76|92|100
1|Which band was John Lennon a member of?|The Beatles|The Rolling Stones|The Who|Queen
1|Who is known as the “King of Pop”?|Michael Jackson|Elvis Presley|Prince|Justin Timberlake
1|Who is known as the “King of Rock and Roll”?|Elvis Presley|Chuck Berry|Little Richard|Jerry Lee Lewis
1|Freddie Mercury was the lead singer of which band?|Queen|Led Zeppelin|The Police|Aerosmith
2|Who composed “Für Elise”?|Ludwig van Beethoven|Wolfgang Amadeus Mozart|Frédéric Chopin|Johann Sebastian Bach
2|Which composer kept writing music after losing his hearing, including nine symphonies?|Beethoven|Mozart|Haydn|Brahms
1|Which Swedish group sang “Dancing Queen”?|ABBA|Roxette|Ace of Base|The Cardigans
3|Which orchestral instrument usually has 47 strings?|The harp|The cello|The piano|The double bass
2|How many lines are there on a musical staff?|5|4|6|7
2|Which singer released the album “21” in 2011?|Adele|Amy Winehouse|Lady Gaga|Taylor Swift
1|Bob Marley is best known for which kind of music?|Reggae|Ska|Calypso|Blues
2|Which band recorded “Smells Like Teen Spirit”?|Nirvana|Pearl Jam|Soundgarden|Foo Fighters
2|“Like a Prayer” was a hit for which singer?|Madonna|Cyndi Lauper|Whitney Houston|Janet Jackson
2|Which rapper’s real name is Marshall Mathers?|Eminem|Jay-Z|Snoop Dogg|Dr. Dre
2|Which Italian music term means “gradually getting louder”?|Crescendo|Diminuendo|Allegro|Staccato
2|What does “forte” mean in music?|Loud|Soft|Fast|Slow
2|The tango was born in the Río de la Plata region, mainly in which country?|Argentina|Spain|Brazil|Cuba
1|Which instrument did Jimi Hendrix famously play?|Electric guitar|Drums|Saxophone|Piano
2|Which is the highest female singing voice?|Soprano|Alto|Mezzo-soprano|Contralto
2|Who composed “The Four Seasons”?|Antonio Vivaldi|Johann Sebastian Bach|George Frideric Handel|Joseph Haydn
1|Which band sang “Hey Jude”?|The Beatles|The Beach Boys|The Kinks|The Monkees
3|Which country won the very first Eurovision Song Contest in 1956?|Switzerland|Italy|France|The Netherlands
1|Bono is the lead singer of which Irish band?|U2|The Cranberries|Thin Lizzy|The Pogues
1|How many musicians play in a quartet?|4|3|5|6
2|Who sang “Purple Rain”?|Prince|Michael Jackson|Lenny Kravitz|Stevie Wonder
1|“Shake It Off” (2014) is a song by…|Taylor Swift|Katy Perry|Ariana Grande|Selena Gomez
3|How many symphonies did Mozart write, by the usual count?|41|9|27|104
2|Which instrument has keys, pedals and pipes and is often found in churches?|The organ|The harpsichord|The accordion|The celesta`,

  screen: `
1|Which film series is known for the line “May the Force be with you”?|Star Wars|Star Trek|Dune|Avatar
1|What is the name of the lion cub hero of “The Lion King”?|Simba|Mufasa|Nala|Scar
1|Who directed “Jurassic Park” (1993)?|Steven Spielberg|James Cameron|George Lucas|Ridley Scott
1|In which film does a giant shark terrorise the beaches of Amity Island?|Jaws|The Meg|Deep Blue Sea|The Shallows
2|In the 1939 film “The Wizard of Oz”, what colour are Dorothy’s slippers?|Ruby red|Silver|Gold|Emerald green
1|What is the name of the school of witchcraft and wizardry in Harry Potter?|Hogwarts|Durmstrang|Beauxbatons|Ilvermorny
1|Who played Jack in “Titanic” (1997)?|Leonardo DiCaprio|Brad Pitt|Matt Damon|Johnny Depp
1|Which TV series features the houses Stark and Lannister?|Game of Thrones|The Witcher|Vikings|The Last Kingdom
2|What is the name of the coffee shop in “Friends”?|Central Perk|Monk’s Café|The Max|Luke’s Diner
1|Which animated film features a snowman named Olaf?|Frozen|Tangled|Moana|Brave
1|What is the name of the cowboy doll in “Toy Story”?|Woody|Buzz|Jessie|Bullseye
2|In which city is “Breaking Bad” set?|Albuquerque|Las Vegas|Phoenix|El Paso
2|Which was the first film not in English to win the Oscar for Best Picture?|Parasite|Roma|Amélie|Crouching Tiger, Hidden Dragon
2|Who voices Woody in “Toy Story”?|Tom Hanks|Tim Allen|Billy Crystal|Robin Williams
1|Which actor played Iron Man in the Marvel films?|Robert Downey Jr.|Chris Evans|Chris Hemsworth|Mark Ruffalo
1|What does Doc Brown turn into a time machine in “Back to the Future”?|A DeLorean|A Mustang|A Corvette|A Porsche
1|In “Finding Nemo”, what kind of fish is Nemo?|A clownfish|A blue tang|A goldfish|A pufferfish
1|In “The Matrix”, which pill does Neo take?|The red one|The blue one|The green one|The white one
2|Which series is set in the fictional town of Hawkins, Indiana?|Stranger Things|Twin Peaks|Riverdale|Smallville
1|Which cartoon family lives in Springfield and has a son named Bart?|The Simpsons|The Griffins|The Belchers|The Flintstones
2|Who directed “Pulp Fiction”?|Quentin Tarantino|Martin Scorsese|Guy Ritchie|Joel Coen
2|In “Shrek”, who does Donkey fall in love with?|A dragon|A horse|A cat|A princess
2|How many Infinity Stones are there in the Marvel films?|6|5|7|4
1|Which hobbit does Elijah Wood play in “The Lord of the Rings”?|Frodo Baggins|Bilbo Baggins|Samwise Gamgee|Pippin Took
2|“The Office” (US) is set at a paper company branch in which city?|Scranton|Stamford|Pittsburgh|Buffalo
1|Which 1994 film has the line “Life is like a box of chocolates”?|Forrest Gump|The Shawshank Redemption|Pulp Fiction|The Lion King
1|What is the family name in “The Godfather”?|Corleone|Soprano|Gambino|Montana
2|Ethan Hunt is the hero of which film series?|Mission: Impossible|James Bond|The Bourne films|Fast & Furious
1|Which South Korean series is about a deadly contest based on children’s games?|Squid Game|Alice in Borderland|Kingdom|Sweet Home
3|Which film won the first Academy Award for Best Picture?|Wings|Sunrise|The Jazz Singer|Metropolis
2|What is the name of the ship in “Pirates of the Caribbean” captained by Jack Sparrow?|The Black Pearl|The Flying Dutchman|The Queen Anne’s Revenge|The Jolly Roger`,

  sports: `
1|How many players does a football (soccer) team have on the pitch?|11|10|9|12
1|How many players does a basketball team have on the court?|5|6|7|4
1|How often are the Summer Olympic Games normally held?|Every 4 years|Every 2 years|Every 3 years|Every 5 years
1|In tennis, what is a score of zero called?|Love|Nil|Zero|Duck
1|How many holes are played in a standard round of golf?|18|9|12|21
2|How long is a marathon?|42.195 km|40 km|44.5 km|38.6 km
1|In which sport would you see a slam dunk?|Basketball|Volleyball|Handball|Water polo
2|Traditionally, what colour is the centre of an archery target?|Gold (yellow)|Red|Blue|Black
1|How many rings are there on the Olympic flag?|5|4|6|7
1|Which country hosted the 2016 Summer Olympics?|Brazil|China|The United Kingdom|Japan
1|Which sport uses a shuttlecock?|Badminton|Squash|Table tennis|Tennis
2|How many points is a touchdown worth in American football, before the extra point?|6|7|3|5
2|Who has won more Olympic medals than any other athlete?|Michael Phelps|Usain Bolt|Larisa Latynina|Carl Lewis
1|Which tennis tournament is played on grass in London?|Wimbledon|Roland Garros|The US Open|The Australian Open
2|In which sport is the Stanley Cup awarded?|Ice hockey|Baseball|Basketball|American football
2|How many players does a volleyball team have on court?|6|5|7|4
3|What is the maximum break in snooker (without a free ball)?|147|155|120|180
2|What is the highest score possible with three darts?|180|150|160|200
1|Which country is the sprinter Usain Bolt from?|Jamaica|The United States|Trinidad and Tobago|The Bahamas
1|How long is a football (soccer) match, not counting extra time?|90 minutes|80 minutes|100 minutes|60 minutes
2|In which country was judo created?|Japan|China|Korea|Brazil
2|How many players does a cricket team have?|11|9|10|12
1|In bowling, what is it called when all ten pins fall with the first ball?|A strike|A spare|A split|A turkey
1|The Tour de France is a race in which sport?|Cycling|Running|Sailing|Motor racing
2|How long is an Olympic swimming pool?|50 metres|25 metres|100 metres|75 metres
1|In which country did the ancient Olympic Games begin?|Greece|Italy|Egypt|Turkey
1|Who ran 100 metres in 9.58 seconds in 2009, setting a world record?|Usain Bolt|Yohan Blake|Tyson Gay|Asafa Powell
3|How many players does a rugby union team have on the field?|15|13|11|12
3|Which country won the first FIFA World Cup, in 1930?|Uruguay|Brazil|Argentina|Italy
2|In tennis, what is the score 40–40 called?|Deuce|Advantage|Love all|A tie
2|In which sport can a player score a “hat-trick” by scoring three goals in one game?|Football (soccer)|Tennis|Golf|Swimming
3|In which city were the first modern Olympic Games held, in 1896?|Athens|Paris|London|Rome`,

  food: `
1|What is the main ingredient of guacamole?|Avocado|Tomato|Pea|Cucumber
1|Which country is pizza Margherita from?|Italy|Greece|France|Spain
1|What is sushi traditionally wrapped in?|Seaweed (nori)|Rice paper|Lettuce|Soy paper
2|Which nut is marzipan made from?|Almonds|Walnuts|Hazelnuts|Cashews
1|Hummus is made mainly from which legume?|Chickpeas|Lentils|Fava beans|Peas
2|Which is the most expensive spice by weight?|Saffron|Vanilla|Cardamom|Cinnamon
1|What is tofu made from?|Soybeans|Rice|Chickpeas|Wheat
2|Which strong-smelling fruit is called the “king of fruits” in Southeast Asia?|Durian|Jackfruit|Mango|Lychee
1|Which country does paella come from?|Spain|Portugal|Mexico|Italy
2|Besides yoghurt, what is the main ingredient of Greek tzatziki?|Cucumber|Tomato|Eggplant|Spinach
3|Which pastry are profiteroles made from?|Choux pastry|Puff pastry|Shortcrust pastry|Filo pastry
1|Pad thai comes from which country?|Thailand|Vietnam|China|Malaysia
1|Which grain is used to brew Japanese sake?|Rice|Barley|Wheat|Corn
2|What is the main ingredient of Scottish haggis?|Sheep’s heart, liver and lungs|Minced beef|Pork belly|Salmon
1|Brie and Camembert are cheeses from which country?|France|Switzerland|Italy|The Netherlands
2|Which vegetable gives classic borscht its deep red colour?|Beetroot|Red cabbage|Red pepper|Tomato
2|What are Italian potato dumplings called?|Gnocchi|Ravioli|Tortellini|Orzo
3|Which pasta’s name means “little tongues” in Italian?|Linguine|Fettuccine|Penne|Farfalle
1|Which fruit is dried to make raisins?|Grapes|Plums|Figs|Apricots
1|Prunes are dried…|Plums|Grapes|Dates|Cherries
2|What is the Japanese name for slices of raw fish served without rice?|Sashimi|Sushi|Tempura|Ramen
1|Kimchi is a traditional dish from which country?|Korea|Japan|China|Thailand
2|What is the main ingredient of baba ghanoush?|Eggplant|Chickpeas|Zucchini|Avocado
1|Tahini is a paste made from which seeds?|Sesame|Sunflower|Pumpkin|Flax
2|Which of these chilli peppers is the hottest?|Carolina Reaper|Jalapeño|Habanero|Cayenne
2|Which lettuce is the base of a classic Caesar salad?|Romaine|Iceberg|Butterhead|Rocket
2|Which fizzy drink is made by fermenting sweet tea?|Kombucha|Kefir|Kvass|Lassi
2|Which country produces the most coffee in the world?|Brazil|Colombia|Vietnam|Ethiopia
1|Shakshuka is tomato sauce cooked with what?|Eggs|Chicken|Cheese|Lentils
2|Which Italian dessert is made with coffee-soaked ladyfingers and mascarpone?|Tiramisu|Panna cotta|Cannoli|Zabaglione
3|Which country is the origin of the cocktail “mojito”?|Cuba|Mexico|Brazil|Spain`,

  tech: `
1|What does “CPU” stand for?|Central Processing Unit|Computer Personal Unit|Central Program Utility|Core Processing Unit
1|What does “HTML” stand for?|HyperText Markup Language|High Tech Modern Language|HyperTransfer Markup Language|Home Tool Markup Language
1|Who founded Apple together with Steve Wozniak and Ronald Wayne?|Steve Jobs|Bill Gates|Paul Allen|Larry Page
1|Who founded Microsoft together with Paul Allen?|Bill Gates|Steve Jobs|Steve Ballmer|Larry Ellison
2|What does “URL” stand for?|Uniform Resource Locator|Universal Reference Link|Unified Resource Line|Uniform Routing Locator
1|How many bits are there in a byte?|8|4|16|10
2|What is the binary number 101 in ordinary decimal numbers?|5|3|6|101
1|Which company makes the Android operating system?|Google|Apple|Microsoft|Samsung
2|In which year did the first iPhone go on sale?|2007|2005|2008|2010
2|Which programming language shares its name with an Indonesian island?|Java|Ruby|Perl|Rust
2|Who designed the Analytical Engine and is called a “father of the computer”?|Charles Babbage|Alan Turing|John von Neumann|Ada Lovelace
2|Who is often called the first computer programmer?|Ada Lovelace|Grace Hopper|Charles Babbage|Alan Turing
2|What does “USB” stand for?|Universal Serial Bus|Unified System Bus|Universal Storage Block|United Serial Board
1|Which company created the PlayStation?|Sony|Nintendo|Microsoft|Sega
1|What does “GPS” stand for?|Global Positioning System|General Positioning Service|Geographic Pointing System|Global Path Satellite
3|What was the name of the 1993 web browser that made the web popular with pictures?|Mosaic|Netscape Navigator|Internet Explorer|Opera
1|Which symbol separates the name from the domain in an email address?|@|#|&|%
1|What does “RAM” stand for?|Random Access Memory|Read Access Memory|Rapid Action Module|Run Anywhere Memory
1|Which company makes Windows?|Microsoft|Apple|IBM|Google
2|What are 1,024 bytes traditionally called?|A kilobyte|A megabyte|A gigabyte|A bit
1|Who started Facebook with fellow students in 2004?|Mark Zuckerberg|Jack Dorsey|Larry Page|Evan Spiegel
1|What does “www” stand for in a web address?|World Wide Web|World Web Wide|Wide World Web|Web World Wide
2|Which language is used to style the look of web pages?|CSS|Python|SQL|C++
1|Which company makes the Galaxy phones?|Samsung|LG|Huawei|Sony
1|What is the name of Apple’s voice assistant?|Siri|Alexa|Cortana|Bixby
2|Which British mathematician worked on breaking Enigma and is a founder of computer science?|Alan Turing|Charles Babbage|Tim Berners-Lee|John McCarthy
2|Who invented the World Wide Web?|Tim Berners-Lee|Vint Cerf|Bill Gates|Marc Andreessen
2|What does “SSD” stand for?|Solid-State Drive|Super Speed Disk|System Storage Device|Secure Serial Drive
2|What does “PDF” stand for?|Portable Document Format|Printable Data File|Public Document Form|Personal Digital File
3|Which number system uses only the digits 0–9 and the letters A–F?|Hexadecimal|Binary|Octal|Decimal
2|What does “Wi-Fi” let devices do?|Connect to a network without cables|Charge without cables|Print in colour|Store more files`,

  israel: `
1|In which year was the State of Israel founded?|1948|1947|1949|1967
1|Which freshwater lake in northern Israel is also called the Sea of Galilee?|The Kinneret|Lake Hula|The Dead Sea|Lake Ram
1|Who was Israel’s first prime minister?|David Ben-Gurion|Golda Meir|Chaim Weizmann|Menachem Begin
2|Who was Israel’s first president?|Chaim Weizmann|David Ben-Gurion|Yitzhak Ben-Zvi|Theodor Herzl
1|Who was Israel’s first female prime minister?|Golda Meir|Tzipi Livni|Shulamit Aloni|Ayelet Shaked
1|What is Israel’s currency called?|The new shekel|The lira|The dinar|The pound
1|What is the name of Israel’s national anthem?|Hatikvah|Jerusalem of Gold|Hava Nagila|Eli, Eli
1|Which city is Israel’s port on the Red Sea?|Eilat|Ashdod|Haifa|Ashkelon
2|Which Israeli city is called the “White City” for its Bauhaus buildings?|Tel Aviv|Haifa|Jerusalem|Netanya
2|Which mountain ridge runs through Haifa?|Mount Carmel|Mount Gilboa|Mount Meron|Mount Tabor
2|What is the huge erosion crater next to Mitzpe Ramon called?|Makhtesh Ramon|Ein Gedi|Timna|The Arava
1|Which desert fortress above the Dead Sea is a UNESCO World Heritage Site?|Masada|Herodium|Caesarea|Megiddo
1|Which Israeli singer won Eurovision 2018 with “Toy”?|Netta Barzilai|Dana International|Noa Kirel|Ofra Haza
3|In which year did Israel first win Eurovision, with “A-Ba-Ni-Bi”?|1978|1979|1998|1973
2|With which song did Milk and Honey win Eurovision for Israel in 1979?|“Hallelujah”|“A-Ba-Ni-Bi”|“Diva”|“Toy”
2|In which year did Dana International win Eurovision with “Diva”?|1998|1995|2000|1991
1|The navigation app Waze was started in which country?|Israel|The United States|Sweden|Germany
1|What is Israel’s parliament called?|The Knesset|The Sanhedrin|The Histadrut|The Kotel
2|How many members sit in the Knesset?|120|100|150|99
2|Which is Israel’s largest city by population?|Jerusalem|Tel Aviv|Haifa|Rishon LeZion
1|Which river flows from the Sea of Galilee to the Dead Sea?|The Jordan|The Yarkon|The Kishon|The Nile
1|What is the name of the Jewish New Year?|Rosh Hashanah|Yom Kippur|Sukkot|Shavuot
1|On which holiday are sufganiyot (doughnuts) traditionally eaten?|Hanukkah|Purim|Passover|Shavuot
1|On which holiday do people dress up in costumes?|Purim|Hanukkah|Lag BaOmer|Tu BiShvat
2|Which holiday is the “New Year of the Trees”?|Tu BiShvat|Tu B’Av|Sukkot|Lag BaOmer
1|What is the name of Israel’s national airline?|El Al|Arkia|Israir|Sun d’Or
2|Who wrote “A Tale of Love and Darkness”?|Amos Oz|A. B. Yehoshua|David Grossman|Etgar Keret
2|Which Israeli writer won the Nobel Prize in Literature in 1966?|S. Y. Agnon|Amos Oz|Natan Alterman|Yehuda Amichai
2|The Israeli company Mobileye is best known for technology for…|Driver assistance and self-driving cars|Mobile games|Online payments|Satellite phones
2|In which city are the Bahá’í Gardens and the Shrine of the Báb?|Haifa|Akko|Jerusalem|Nazareth
2|Which ancient port was built by King Herod and named in honour of Augustus?|Caesarea|Jaffa|Akko|Ashkelon
2|Which bird was chosen as Israel’s national bird in 2008?|The hoopoe|The eagle|The stork|The dove
3|Which Israeli team won the European Champions Cup in basketball in 1977?|Maccabi Tel Aviv|Hapoel Jerusalem|Hapoel Tel Aviv|Maccabi Haifa
3|Which early USB flash drive was developed by the Israeli company M-Systems?|DiskOnKey|ThumbDrive|Memory Stick|ZipDisk`,
};
