import Machine from './Machine'
import Craft from './Craft'
import MachineCraft from './MachineCraft'
import Ingredient from './Ingredient'

export default class Factory {
    machines: Machine[]
    factories: Factory[]

    constructor (machines?: Machine[], factories?: Factory[]) {
        if (machines !== undefined) {
            this.machines = machines
        } else {
            this.machines = []
        }

        if (factories !== undefined) {
            this.factories = factories
        } else {
            this.factories = []
        }
    }

    addSubFactory (): void {
        this.factories.push(new Factory())
    }

    buildMachine (machineCraft: MachineCraft, manual = false): Machine {
        const machine = new Machine(machineCraft.name, machineCraft.outputCraft, manual)
        this.machines.push(machine)
        return machine
    }

    destroyMachine (machine: Machine): void {
        this.machines = this.machines.filter((elem) => {
            return elem !== machine
        })
    }

    getMachinesOfType (machineCraft: Craft): Machine[] {
        return this.machines.filter((machine) => machine.craft.id === machineCraft.id)
    }

    destroySubFactory (subFactory: Factory): void {
        subFactory.machines.forEach((machine) => subFactory.destroyMachine(machine))
        subFactory.factories.forEach((factory) => subFactory.destroySubFactory(factory))
        this.factories = this.factories.filter((elem) => {
            return elem !== subFactory
        })
    }

    public get inputs (): Ingredient[] {
        const allInputs: Ingredient[] = []
        allInputs.push(...this.machines.map((machine) => machine.craft.input).flat())
        allInputs.push(...this.factories.map((factory) => factory.inputs).flat())
        return Ingredient.mergeIngredient(allInputs)
    }

    public get outputs (): Ingredient[] {
        const allOutputs: Ingredient[] = []
        allOutputs.push(...this.machines.map((machine) => machine.craft.output).flat())
        allOutputs.push(...this.factories.map((factory) => factory.outputs).flat())
        return Ingredient.mergeIngredient(allOutputs)
    }
}
