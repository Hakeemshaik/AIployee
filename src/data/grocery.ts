import type { Food } from '../types'
import { unitFoods, weightFoods } from './build'

/**
 * Everyday groceries and whole foods, the stuff you weigh at home.
 *
 * Weight rows are per 100 g: [name, kcal, P, C, F, fibre, sugar, sodium, portions?]
 * Raw vs cooked matters a lot for meat and grains, so it is always in the name.
 * Values follow standard composition tables; check your pack label and edit the
 * food if your brand differs.
 */

const beef = weightFoods(undefined, 'beef', [
  ['Beef mince, extra lean (5% fat), raw', 137, 21.5, 0, 5, 0, 0, 66,
    [['200 g', 200], ['500 g pack', 500], ['1 kg pack', 1000]]],
  ['Beef mince, lean (10% fat), raw', 176, 20, 0, 10, 0, 0, 66,
    [['200 g', 200], ['500 g pack', 500], ['1 kg pack', 1000]]],
  ['Beef mince, regular (20% fat), raw', 254, 17, 0, 20, 0, 0, 66,
    [['200 g', 200], ['500 g pack', 500], ['1 kg pack', 1000]]],
  ['Beef mince, lean, cooked & drained', 217, 26, 0, 12, 0, 0, 80, [['200 g', 200]]],
  ['Ostrich mince, raw', 115, 22, 0, 2.5, 0, 0, 70, [['200 g', 200], ['500 g pack', 500]]],
  ['Lamb mince, raw', 282, 17, 0, 23, 0, 0, 70, [['200 g', 200], ['500 g pack', 500]]],
  ['Rump steak, raw', 165, 22, 0, 8, 0, 0, 55, [['200 g steak', 200], ['300 g steak', 300]]],
  ['Sirloin steak, raw', 172, 22, 0, 9, 0, 0, 55, [['200 g steak', 200], ['300 g steak', 300]]],
  ['Fillet steak, raw', 152, 22, 0, 7, 0, 0, 50, [['200 g steak', 200], ['300 g steak', 300]]],
  ['Ribeye steak, raw', 242, 20, 0, 18, 0, 0, 55, [['250 g steak', 250], ['350 g steak', 350]]],
  ['T-bone steak, raw', 210, 20, 0, 14.5, 0, 0, 58, [['300 g steak', 300], ['400 g steak', 400]]],
  ['Beef brisket, raw', 250, 19, 0, 19, 0, 0, 65],
  ['Beef chuck / stewing beef, raw', 200, 20, 0, 13, 0, 0, 60],
  ['Beef steak, grilled (lean)', 220, 30, 0, 11, 0, 0, 60, [['200 g', 200]]],
  ['Biltong, beef (dry)', 313, 55, 3, 9, 0, 1, 2000, [['25 g', 25], ['50 g bag', 50], ['100 g bag', 100]]],
  ['Droëwors', 483, 40, 2, 35, 0, 0, 1800, [['50 g', 50]]],
  ['Boerewors, raw', 320, 15, 2, 28, 0, 1, 700, [['200 g', 200], ['500 g', 500]]],
])

const chicken = weightFoods(undefined, 'chicken', [
  ['Chicken breast fillet, skinless, raw', 120, 23, 0, 2.6, 0, 0, 65,
    [['1 fillet ≈ 150 g', 150], ['2 fillets ≈ 300 g', 300], ['1 kg pack', 1000]]],
  ['Chicken breast, skinless, grilled', 165, 31, 0, 3.6, 0, 0, 75, [['150 g', 150], ['200 g', 200]]],
  ['Chicken thigh, skinless, raw', 121, 19.7, 0, 4, 0, 0, 80, [['1 thigh ≈ 90 g', 90]]],
  ['Chicken thigh with skin, raw', 211, 17, 0, 15.5, 0, 0, 75],
  ['Chicken drumstick with skin, raw', 172, 18, 0, 11, 0, 0, 80, [['1 drumstick ≈ 90 g', 90]]],
  ['Chicken wings with skin, raw', 203, 18, 0, 14, 0, 0, 80],
  ['Whole chicken, roasted, with skin', 239, 27, 0, 14, 0, 0, 85],
  ['Chicken mince, raw', 143, 20, 0, 7, 0, 0, 70, [['200 g', 200], ['500 g pack', 500]]],
  ['Chicken livers, raw', 119, 17, 0.7, 4.8, 0, 0, 70],
  ['Rotisserie chicken, breast meat, no skin', 155, 30, 0, 3.5, 0, 0, 400],
])

const pork = weightFoods(undefined, 'pork', [
  ['Pork chop, raw', 199, 21, 0, 12, 0, 0, 55, [['1 chop ≈ 150 g', 150]]],
  ['Pork fillet, raw', 143, 21, 0, 6, 0, 0, 50],
  ['Bacon, streaky, raw', 393, 13, 1, 37, 0, 0, 1200],
  ['Bacon, back, grilled', 280, 25, 0, 20, 0, 0, 1800],
  ['Gammon / ham slices', 107, 18, 1.5, 3, 0, 1, 1000, [['2 slices ≈ 50 g', 50]]],
  ['Pork sausage, raw', 300, 14, 2, 26, 0, 1, 700],
])

const lamb = weightFoods(undefined, 'lamb', [
  ['Lamb chop, raw', 282, 17, 0, 23, 0, 0, 65, [['1 chop ≈ 100 g', 100]]],
  ['Lamb leg, raw', 201, 20, 0, 13, 0, 0, 60],
  ['Lamb rib / braai chop, raw', 320, 16, 0, 28, 0, 0, 65],
])

const fish = weightFoods(undefined, 'fish', [
  ['Hake fillet, raw', 82, 17.8, 0, 1, 0, 0, 95, [['1 fillet ≈ 150 g', 150]]],
  ['Salmon fillet, raw', 208, 20, 0, 13, 0, 0, 60, [['1 fillet ≈ 150 g', 150]]],
  ['Tuna, canned in water, drained', 116, 26, 0, 1, 0, 0, 320, [['1 tin ≈ 170 g', 170]]],
  ['Tuna, canned in oil, drained', 198, 29, 0, 8, 0, 0, 350, [['1 tin ≈ 170 g', 170]]],
  ['Pilchards / sardines in tomato sauce', 186, 21, 1.5, 10.5, 0, 1, 450, [['1 tin ≈ 400 g', 400]]],
  ['Prawns, raw', 99, 24, 0.2, 0.3, 0, 0, 340],
  ['Mussels, cooked', 172, 24, 7, 4.5, 0, 0, 370],
  ['Snoek, raw', 130, 25, 0, 3, 0, 0, 90],
  ['Kingklip, raw', 95, 20, 0, 1.5, 0, 0, 90],
])

const eggs = unitFoods(undefined, 'eggs', [
  ['Egg, large, whole', 'egg', 50, 72, 6.3, 0.4, 4.8, 0, 0.2, 71],
  ['Egg, jumbo, whole', 'egg', 63, 90, 8, 0.5, 6, 0, 0.2, 89],
  ['Egg white', 'white', 33, 17, 3.6, 0.2, 0.1, 0, 0.2, 55],
  ['Egg yolk', 'yolk', 17, 55, 2.7, 0.6, 4.5, 0, 0.1, 8],
  ['Egg, fried in oil', 'egg', 55, 95, 6.5, 0.4, 7.5, 0, 0.2, 95],
  ['Egg, boiled', 'egg', 50, 72, 6.3, 0.4, 4.8, 0, 0.2, 71],
])

const dairy = weightFoods(undefined, 'dairy', [
  ['Milk, full cream', 62, 3.3, 4.8, 3.3, 0, 4.8, 44, [['1 cup ≈ 250 ml', 250], ['Splash ≈ 30 ml', 30]]],
  ['Milk, low fat (2%)', 50, 3.4, 5, 2, 0, 5, 44, [['1 cup ≈ 250 ml', 250], ['Splash ≈ 30 ml', 30]]],
  ['Milk, fat free', 34, 3.4, 5, 0.2, 0, 5, 44, [['1 cup ≈ 250 ml', 250]]],
  ['Greek yoghurt, plain, full fat', 97, 9, 4, 5, 0, 4, 36, [['1 tub ≈ 175 g', 175], ['200 g', 200]]],
  ['Greek yoghurt, fat free', 59, 10, 3.6, 0.4, 0, 3.6, 36, [['1 tub ≈ 175 g', 175], ['200 g', 200]]],
  ['Double cream yoghurt', 129, 4, 8, 9, 0, 8, 45, [['1 tub ≈ 175 g', 175]]],
  ['Yoghurt, plain low fat', 63, 5.3, 7, 1.6, 0, 7, 55, [['1 tub ≈ 175 g', 175]]],
  ['Bulgarian yoghurt', 75, 4.5, 5, 4, 0, 5, 50, [['1 tub ≈ 175 g', 175]]],
  ['Cheddar cheese', 402, 25, 1.3, 33, 0, 0.5, 620, [['1 slice ≈ 25 g', 25], ['30 g', 30]]],
  ['Mozzarella cheese', 300, 22, 2.2, 22, 0, 1, 490, [['30 g', 30]]],
  ['Gouda cheese', 356, 25, 2.2, 27, 0, 2, 820, [['1 slice ≈ 25 g', 25]]],
  ['Feta cheese', 264, 14, 4, 21, 0, 4, 1100, [['30 g', 30], ['50 g', 50]]],
  ['Cottage cheese, smooth low fat', 98, 11, 3.4, 4.3, 0, 3, 360, [['1 tub ≈ 250 g', 250]]],
  ['Cream cheese', 342, 6, 4, 34, 0, 3, 320, [['1 tbsp ≈ 15 g', 15]]],
  ['Parmesan cheese', 392, 36, 3.2, 25, 0, 0.9, 1500, [['1 tbsp ≈ 5 g', 5]]],
  ['Cream, fresh', 340, 2, 3, 36, 0, 3, 38, [['1 tbsp ≈ 15 g', 15]]],
])

const carbs = weightFoods(undefined, 'carbs', [
  ['White rice, cooked', 130, 2.7, 28, 0.3, 0.4, 0.1, 1, [['1 cup ≈ 160 g', 160], ['200 g', 200]]],
  ['White rice, uncooked', 360, 7, 79, 0.7, 1.3, 0.1, 5, [['½ cup ≈ 90 g', 90]]],
  ['Brown rice, cooked', 123, 2.7, 26, 1, 1.6, 0.4, 4, [['1 cup ≈ 160 g', 160]]],
  ['Basmati rice, cooked', 130, 3, 28, 0.4, 0.6, 0.1, 2, [['1 cup ≈ 160 g', 160]]],
  ['Potato, raw', 77, 2, 17, 0.1, 2.2, 0.8, 6, [['1 medium ≈ 170 g', 170]]],
  ['Potato, boiled', 87, 2, 20, 0.1, 1.8, 0.9, 5, [['200 g', 200]]],
  ['Sweet potato, raw', 86, 1.6, 20, 0.1, 3, 4.2, 55, [['1 medium ≈ 150 g', 150]]],
  ['Pap / stywe pap, cooked', 110, 2.3, 24, 0.5, 1.2, 0.2, 3, [['1 cup ≈ 180 g', 180]]],
  ['Maize meal, dry', 362, 8, 76, 1.5, 4, 0.6, 5],
  ['Pasta, cooked', 158, 5.8, 31, 0.9, 1.8, 0.6, 1, [['1 cup ≈ 140 g', 140]]],
  ['Pasta, dry', 371, 13, 75, 1.5, 3.2, 2.7, 6, [['80 g portion', 80], ['100 g', 100]]],
  ['Oats, raw', 379, 13, 67, 7, 10, 1, 6, [['½ cup ≈ 45 g', 45], ['80 g', 80]]],
  ['Oats, cooked with water', 71, 2.5, 12, 1.5, 1.7, 0.3, 4, [['1 bowl ≈ 250 g', 250]]],
  ['Couscous, cooked', 112, 3.8, 23, 0.2, 1.4, 0.1, 5, [['1 cup ≈ 160 g', 160]]],
  ['Quinoa, cooked', 120, 4.4, 21, 1.9, 2.8, 0.9, 7, [['1 cup ≈ 185 g', 185]]],
  ['Samp, cooked', 110, 2.5, 23, 0.5, 2, 0.3, 4],
  ['Corn Flakes', 378, 7, 84, 0.9, 3, 8, 700, [['40 g bowl', 40]]],
  ['Muesli', 380, 10, 66, 8, 8, 20, 100, [['50 g', 50]]],
])

const breads = unitFoods(undefined, 'carbs', [
  ['Bread, white (slice)', 'slice', 36, 92, 3, 17, 1, 0.8, 1.5, 170],
  ['Bread, brown (slice)', 'slice', 36, 85, 3.5, 16, 1, 2, 1.5, 165],
  ['Bread, low GI seed loaf (slice)', 'slice', 40, 100, 4.5, 14, 2.5, 3, 1.5, 180],
  ['Bread roll, wholewheat', 'roll', 70, 180, 7, 32, 2.5, 4, 2, 330],
  ['Burger bun', 'bun', 65, 190, 6, 33, 3.5, 1.5, 4, 330],
  ['Hot dog roll', 'roll', 55, 150, 5, 27, 2, 1.2, 3, 280],
  ['Wrap / tortilla (medium)', 'wrap', 55, 160, 4.5, 26, 4, 1.5, 1, 350],
  ['Pita bread', 'pita', 60, 165, 5.5, 33, 0.7, 1.3, 0.4, 320],
  ['Weet-Bix (biscuit)', 'biscuit', 16.5, 59, 2, 11.5, 0.4, 1.5, 0.2, 40],
  ['ProNutro (50 g serving)', 'serving', 50, 190, 8, 34, 2.5, 2, 8, 200],
  ['Provita (biscuit)', 'biscuit', 8, 30, 1, 5.5, 0.5, 0.8, 0.1, 45],
  ['Rice cake', 'cake', 9, 35, 0.7, 7.3, 0.3, 0.4, 0.1, 25],
])

const legumes = weightFoods(undefined, 'legumes', [
  ['Baked beans in tomato sauce', 94, 4.8, 15, 0.5, 4.5, 5, 400, [['½ tin ≈ 200 g', 200], ['1 tin ≈ 410 g', 410]]],
  ['Lentils, cooked', 116, 9, 20, 0.4, 8, 1.8, 2, [['1 cup ≈ 200 g', 200]]],
  ['Chickpeas, cooked', 164, 8.9, 27, 2.6, 7.6, 4.8, 7, [['1 cup ≈ 165 g', 165]]],
  ['Kidney beans, cooked', 127, 8.7, 23, 0.5, 6.4, 0.3, 2, [['1 cup ≈ 175 g', 175]]],
  ['Black beans, cooked', 132, 8.9, 24, 0.5, 8.7, 0.3, 2],
  ['Soya mince, dry', 340, 50, 30, 1.5, 18, 3, 20, [['50 g', 50]]],
])

const veg = weightFoods(undefined, 'veg', [
  ['Broccoli, raw', 34, 2.8, 7, 0.4, 2.6, 1.7, 33, [['1 head ≈ 300 g', 300]]],
  ['Spinach, raw', 23, 2.9, 3.6, 0.4, 2.2, 0.4, 79, [['1 handful ≈ 30 g', 30]]],
  ['Green beans, raw', 31, 1.8, 7, 0.2, 2.7, 3.3, 6],
  ['Carrots, raw', 41, 0.9, 10, 0.2, 2.8, 4.7, 69],
  ['Tomato, raw', 18, 0.9, 3.9, 0.2, 1.2, 2.6, 5, [['1 medium ≈ 120 g', 120]]],
  ['Onion, raw', 40, 1.1, 9.3, 0.1, 1.7, 4.2, 4, [['1 medium ≈ 110 g', 110]]],
  ['Mushrooms, raw', 22, 3.1, 3.3, 0.3, 1, 2, 5, [['1 punnet ≈ 250 g', 250]]],
  ['Butternut, raw', 45, 1, 12, 0.1, 2, 2.2, 4],
  ['Cauliflower, raw', 25, 1.9, 5, 0.3, 2, 1.9, 30],
  ['Cabbage, raw', 25, 1.3, 6, 0.1, 2.5, 3.2, 18],
  ['Lettuce', 15, 1.4, 2.9, 0.2, 1.3, 0.8, 28],
  ['Cucumber', 15, 0.7, 3.6, 0.1, 0.5, 1.7, 2],
  ['Green pepper, raw', 20, 0.9, 4.6, 0.2, 1.7, 2.4, 3],
  ['Avocado', 160, 2, 8.5, 15, 6.7, 0.7, 7, [['½ medium ≈ 70 g', 70], ['1 medium ≈ 140 g', 140]]],
  ['Peas, frozen', 81, 5.4, 14, 0.4, 5, 5.7, 5, [['1 cup ≈ 145 g', 145]]],
  ['Sweetcorn kernels', 86, 3.3, 19, 1.2, 2.7, 3.2, 15],
  ['Mixed frozen vegetables', 65, 3, 13, 0.4, 4, 3.5, 40, [['1 cup ≈ 150 g', 150]]],
])

const fruit = weightFoods(undefined, 'fruit', [
  ['Banana', 89, 1.1, 23, 0.3, 2.6, 12, 1, [['1 medium ≈ 118 g', 118], ['1 large ≈ 136 g', 136]]],
  ['Apple', 52, 0.3, 14, 0.2, 2.4, 10, 1, [['1 medium ≈ 182 g', 182]]],
  ['Orange', 47, 0.9, 12, 0.1, 2.4, 9, 0, [['1 medium ≈ 130 g', 130]]],
  ['Grapes', 69, 0.7, 18, 0.2, 0.9, 16, 2, [['1 cup ≈ 150 g', 150]]],
  ['Strawberries', 32, 0.7, 7.7, 0.3, 2, 4.9, 1, [['1 cup ≈ 150 g', 150]]],
  ['Blueberries', 57, 0.7, 14, 0.3, 2.4, 10, 1, [['125 g punnet', 125]]],
  ['Mango', 60, 0.8, 15, 0.4, 1.6, 14, 1, [['1 medium ≈ 200 g', 200]]],
  ['Pineapple', 50, 0.5, 13, 0.1, 1.4, 10, 1],
  ['Watermelon', 30, 0.6, 7.6, 0.2, 0.4, 6.2, 1, [['1 slice ≈ 280 g', 280]]],
  ['Naartjie', 53, 0.8, 13, 0.3, 1.8, 11, 2, [['1 medium ≈ 90 g', 90]]],
  ['Dates, dried', 282, 2.5, 75, 0.4, 8, 63, 2, [['2 dates ≈ 48 g', 48]]],
])

const nuts = weightFoods(undefined, 'nuts', [
  ['Peanut butter', 588, 25, 20, 50, 6, 9, 430, [['1 tbsp ≈ 16 g', 16], ['2 tbsp ≈ 32 g', 32]]],
  ['Almonds', 579, 21, 22, 50, 12.5, 4.4, 1, [['30 g handful', 30]]],
  ['Cashews', 553, 18, 30, 44, 3.3, 5.9, 12, [['30 g handful', 30]]],
  ['Peanuts, salted', 567, 26, 16, 49, 8.5, 4, 400, [['30 g handful', 30]]],
  ['Walnuts', 654, 15, 14, 65, 6.7, 2.6, 2, [['30 g handful', 30]]],
  ['Macadamias', 718, 8, 14, 76, 8.6, 4.6, 5, [['30 g handful', 30]]],
  ['Chia seeds', 486, 17, 42, 31, 34, 0, 16, [['1 tbsp ≈ 12 g', 12]]],
  ['Sunflower seeds', 584, 21, 20, 51, 8.6, 2.6, 9, [['30 g', 30]]],
])

const fats = weightFoods(undefined, 'fats', [
  ['Olive oil', 884, 0, 0, 100, 0, 0, 2, [['1 tsp ≈ 4.5 g', 4.5], ['1 tbsp ≈ 14 g', 14]]],
  ['Sunflower oil', 884, 0, 0, 100, 0, 0, 0, [['1 tsp ≈ 4.5 g', 4.5], ['1 tbsp ≈ 14 g', 14]]],
  ['Coconut oil', 862, 0, 0, 100, 0, 0, 0, [['1 tbsp ≈ 14 g', 14]]],
  ['Butter', 717, 0.9, 0.1, 81, 0, 0.1, 640, [['1 tsp ≈ 5 g', 5], ['1 tbsp ≈ 14 g', 14]]],
  ['Margarine / spread', 600, 0.2, 0.7, 66, 0, 0, 750, [['1 tsp ≈ 5 g', 5]]],
  ['Mayonnaise', 680, 1, 1.5, 75, 0, 1.5, 640, [['1 tbsp ≈ 14 g', 14]]],
  ['Mayonnaise, lite', 300, 1, 8, 29, 0, 5, 800, [['1 tbsp ≈ 14 g', 14]]],
])

const sauces = weightFoods(undefined, 'sauces', [
  ['Tomato sauce', 100, 1.2, 24, 0.1, 0.3, 22, 900, [['1 tbsp ≈ 17 g', 17]]],
  ["Mrs Ball's chutney", 240, 0.5, 58, 0.2, 1, 50, 400, [['1 tbsp ≈ 20 g', 20]]],
  ["Nando's peri-peri sauce", 60, 1, 8, 2.5, 1, 5, 1300, [['1 tbsp ≈ 15 g', 15]]],
  ['Mustard', 66, 4, 6, 3, 3, 1, 1100, [['1 tsp ≈ 5 g', 5]]],
  ['BBQ sauce', 172, 0.8, 41, 0.6, 0.7, 33, 1000, [['1 tbsp ≈ 17 g', 17]]],
  ['Sweet chilli sauce', 240, 0.5, 58, 0.3, 0.5, 52, 1000, [['1 tbsp ≈ 18 g', 18]]],
  ['Soy sauce', 53, 8, 4.9, 0.6, 0.8, 0.4, 5500, [['1 tbsp ≈ 16 g', 16]]],
  ['Gravy, made up', 40, 1, 6, 1.3, 0.2, 1, 600, [['60 ml ≈ 60 g', 60]]],
])

const snacks = unitFoods(undefined, 'snacks', [
  ['Bar One', 'bar', 55, 260, 3.5, 34, 12, 0.5, 30, 110],
  ['Lunch Bar', 'bar', 48, 250, 3.5, 28, 13, 1, 25, 90],
  ['Kit Kat (4 finger)', 'bar', 45, 233, 3, 28, 12, 0.7, 22, 25],
  ['Cadbury Dairy Milk (80 g slab)', 'slab', 80, 428, 6, 46, 24, 1, 45, 100],
  ['Simba chips (36 g bag)', 'bag', 36, 190, 2.5, 19, 11, 1.4, 1, 250],
  ['Doritos (30 g)', 'portion', 30, 150, 2, 18, 8, 1, 1, 200],
  ['Nik Naks (small bag)', 'bag', 25, 135, 1.3, 15, 8, 0.5, 1, 220],
  ['Popcorn, plain popped (30 g)', 'portion', 30, 116, 3.6, 23, 1.4, 4.3, 0.2, 2],
  ['Ice cream, vanilla (2 scoops)', 'portion', 100, 207, 3.5, 24, 11, 0.7, 21, 80],
  ['Rusk (buttermilk)', 'rusk', 40, 180, 3, 26, 7, 1, 10, 150],
  ['Doughnut, glazed', 'doughnut', 60, 260, 4, 31, 14, 1, 12, 250],
  ['Protein bar (typical)', 'bar', 60, 220, 20, 20, 7, 3, 3, 200],
])

const drinks = unitFoods(undefined, 'drinks', [
  ['Coca-Cola (330 ml can)', 'can', 330, 139, 0, 35, 0, 0, 35, 15],
  ['Coke Zero / Light (330 ml can)', 'can', 330, 1, 0, 0, 0, 0, 0, 25],
  ['Fanta Orange (330 ml can)', 'can', 330, 165, 0, 41, 0, 0, 41, 20],
  ['Sprite (330 ml can)', 'can', 330, 139, 0, 34, 0, 0, 34, 20],
  ['Orange juice (250 ml)', 'glass', 250, 112, 1.7, 26, 0.5, 0.5, 21, 5],
  ['Powerade (500 ml)', 'bottle', 500, 130, 0, 32, 0, 0, 32, 250],
  ['Energade (500 ml)', 'bottle', 500, 140, 0, 34, 0, 0, 32, 230],
  ['Red Bull (250 ml)', 'can', 250, 112, 0, 27, 0, 0, 27, 105],
  ['Monster Energy (500 ml)', 'can', 500, 210, 0, 54, 0, 0, 54, 370],
  ['Black coffee (no milk)', 'cup', 240, 2, 0.3, 0, 0, 0, 0, 5],
  ['Rooibos tea (no milk)', 'cup', 240, 1, 0, 0.2, 0, 0, 0, 2],
  ['Castle Lager (340 ml)', 'bottle', 340, 145, 1.5, 10, 0, 0, 0, 15],
  ['Windhoek Light (340 ml)', 'bottle', 340, 100, 1, 6, 0, 0, 0, 12],
  ['Red wine (150 ml glass)', 'glass', 150, 125, 0.1, 4, 0, 0, 0.9, 6],
  ['White wine (150 ml glass)', 'glass', 150, 121, 0.1, 4, 0, 0, 1.4, 7],
  ['Spirits, 25 ml tot', 'tot', 25, 61, 0, 0, 0, 0, 0, 0],
])

const supplements = unitFoods(undefined, 'supplements', [
  ['Whey protein (1 scoop)', 'scoop', 30, 118, 24, 2, 1.5, 0.5, 1.5, 60],
  ['Casein protein (1 scoop)', 'scoop', 33, 120, 24, 3, 1, 1, 1, 150],
  ['Mass gainer (1 scoop)', 'scoop', 75, 290, 25, 45, 2, 2, 10, 180],
  ['Creatine monohydrate (5 g)', 'serving', 5, 0, 0, 0, 0, 0, 0, 0],
  ['Protein shake, ready to drink', 'bottle', 400, 160, 30, 6, 2, 1, 2, 200],
])

/** A few genuinely store-branded items worth having pre-loaded. */
const branded = unitFoods('Woolworths', 'other', [
  ['Chicken & Mushroom Pie', 'pie', 200, 480, 18, 38, 28, 2, 3, 800],
  ['Rotisserie Chicken (1/4)', 'portion', 200, 320, 35, 1, 19, 0, 0, 600],
  ['Sushi Salmon Roses (6)', 'portion', 180, 320, 14, 50, 6, 1, 8, 700],
  ['Chicken Mayo Sandwich', 'sandwich', 200, 480, 24, 45, 22, 3, 5, 900],
])

export const GROCERY_FOODS: Food[] = [
  ...beef,
  ...chicken,
  ...pork,
  ...lamb,
  ...fish,
  ...eggs,
  ...dairy,
  ...carbs,
  ...breads,
  ...legumes,
  ...veg,
  ...fruit,
  ...nuts,
  ...fats,
  ...sauces,
  ...snacks,
  ...drinks,
  ...supplements,
  ...branded,
]
