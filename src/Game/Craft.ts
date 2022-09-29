import Ingredient from './Ingredient'

class Craft {
    public readonly id: string
    public readonly name: string
    public readonly input: Ingredient[]
    public readonly output: Ingredient[]

    constructor (id: string, name: string, input: Ingredient[], output: Ingredient[]) {
        this.id = id
        this.name = name
        this.input = input
        this.output = output
    }
}
export default Craft
