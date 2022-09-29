import React from 'react'
import { notImplemented } from '..'
import '../css/Machine.css'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'

interface IMachineProps {
    machine: Machine
}

class MachineView extends React.Component<IMachineProps> {
    render (): JSX.Element {
        const canCraft = true // TODO implement if user can manually craft
        const craftBtn = <button onMouseDown={() => notImplemented()}
            onMouseUp={() => notImplemented()}
            onMouseOut={() => notImplemented()}
            className="btn btn-success btn-side btn-craft" disabled={!canCraft}>
            <i className="fas fa-hammer fa-xs"></i>
        </button>

        const destroyBtn = <button onClick={() => notImplemented()} className="btn btn-danger btn-side"><i className="fas fa-trash fa-xs"></i></button>
        const actions = this.props.machine.manual ? <div className="btn-wrapper">{craftBtn}</div> : <div className="btn-wrapper">{destroyBtn}</div>
        return (
            <div className="machine">
                <div className="name">{this.props.machine.name}</div>
                <div className="wrapper">
                    <IngredientsView ingredients={this.props.machine.craft.input} />
                    <div>
                        <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                        <div>{(this.props.machine.craft.duration / 1000).toFixed(1)}s</div>
                        {actions}
                    </div>
                    <IngredientsView ingredients={this.props.machine.craft.output} />
                </div>
            </div>
        )
    }
}
export default MachineView
