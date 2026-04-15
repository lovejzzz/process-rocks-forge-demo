a html game:

This game is about process rocks,  pixel art style. 

[Source Material]
       ↓
    [Process]
       ↓
    [Product]


But the crazy part of the game is, the [Product] can drag back to the source material box becomes source material again, and process again.

1, we just need 3 boxes with arrow and "=".
2, we need a "Forge" button, when user get the source and process ready, just click forge, user will have the product appear in the product box. 

3, on the leftside, we can see the rock, and all the process listed, user can drag it to the boxes.

The process list:
- Flip
- Mosaic a red ruby
- Gold plated
- Split to half

You need a conviced physics engine to make the process look real.
And you need make sure the process can be infinite.

Example, a rock, Gold plated, then Split to half(you can see the inside), then Mosaic a red ruby(will only apply to one half of the thing), then Gold plated again(will see the red ruby covered in gold)....

So we can't hard code everything, we need a flexible system to handle the process.
